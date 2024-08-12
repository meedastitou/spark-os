/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_ctrl_output.c
  Datum:   30.11.2006
  Version: 0.0.1

  This program is free software; you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation; either version 2 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
*/
#include <setjmp.h>
#include <stdio.h>
#include <fcntl.h>
#define __USE_XOPEN
#include <unistd.h>
#include <termios.h>
#include <stdlib.h>
#include <signal.h>
#include <string.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/poll.h>
#include <errno.h>
#define  _S5LIB_C_
#include <as511_s5lib.h>


/*
  Funktion:
    int as511_ctrl_output_insert_op( td_t *, byte_t, byte_t, void* )


  Eingabeparameter: td
                    addr     Ausgangsadresse z.B. 64 = AB64
                    value    Wert, der an der Adresse "addr" ausgegeben werden soll
                    userdata Daten, vom Anwernder

  Ausgabeparameter: 0 bei Erfolg.

  Funktion:
*/
int as511_ctrl_output_insert_op( td_t *td, byte_t addr, byte_t value, void *udata )
{
  dl_t  *dli;
  cop_t  cop;

  if( td != NULL && td->dlh != NULL ) {

    // Prüfe, ob die richtige Datenstruktur übergeben wurde.
    if( td->dlh->dl_type == DL_TYPE_CTRL_OUTPUT ) {
      cop.addr  = addr;  // Adresse 0x00 für AB 0
      cop.value = value; // Wert der an AB 0 geschrieben werden soll

      dli = dlh_insert_last( td->dlh );
      if( dl_insert_data( td->dlh, dli, DL_TYPE_CTRL_OUTPUT, &cop, sizeof(cop_t), udata ) > 0 )
        return 1; // Fehler
    }
    return NO_ERROR; // OK
  }
  return 1; // Fehler
}


// Einleiten der Funktion AUSGAENGE STEUERN
int as511_ctrl_output_init( td_t *td )
{
  int rc = NO_ERROR;
  unsigned char ch;

  td->errnr = NO_ERROR;

  if( (rc = sigsetjmp(td->env, 1 )) == NO_ERROR ) {
    if( protokoll_start( td, S5_CTRL_OUTPUT_INIT ) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);
      lese_byte_v2(td, &ch, 0, 0);
#if 1
      switch( ch ) {
        case 0x10:
          lese_byte_v2(td, &ch, 0x10, 1);
          td->errnr = NO_ERROR;
          break;
        case 0x12:
          td->errnr = ERROR_AG_RUNING;
          break;
        default:
          td->errnr = CHAR_UNKNOWN;
          break;
      }
#else
      if( ch == 0x10 )
        lese_byte_v2(td, &ch, 0x10, 1);
      else if( ch == 0x12 )
        td->errnr = ERROR_AG_RUNING;
      else
        td->errnr = CHAR_UNKNOWN;
#endif
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ETX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);
    }
  }
  else {
    td->errnr = rc;
  }
  return (td->errnr) ? 1:NO_ERROR;
}

// AUSGAENGE STEUERN
copbl_t *as511_ctrl_output_start( td_t *td )
{
  int     index;
  byte_t  ch;
  cop_t   *c;
  copbl_t *bl = NULL;
  dl_t  *dl;

  index  = 0;
  td->errnr = 0;

  if( sigsetjmp(td->env, 1) == NO_ERROR ) {
    if( protokoll_start( td, S5_CTRL_OUTPUT ) ) {
      for( dl = td->dlh->f; dl != NULL; dl = dl->n ) {
        c = DL_GET_DATA(cop_t, dl );
        schreibe_daten_v2(td, c->addr );
        schreibe_daten_v2(td, c->value );
      }
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);
      lese_byte_v2(td, &ch, 0, 0);
      if( ch == FS ) {
        // Falls eine Adresse angegeben, die nicht ansprechbar ist
        // werden in der Variabeln "badlst" die fehlerhaften Adressen
        // eingetragen.
        index = as511_read_data( td );

        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
        lese_byte_v2(td, &ch, DC2, 1);
      }
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ETX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);

      // Fehlermeldungen des AG Speichern
      if( index ) {
        bl = Malloc(sizeof(copbl_t));
        bl->badlst = Malloc(index);
        bl->badlstsize = index;
        memcpy(bl->badlst, td->mem, index);
        td->errnr = CTRL_OUTP_BADLST;
      }
    }
  }
  return bl;
}

// Beenden der Funktion AUSGAENGE STEUERN
int as511_ctrl_output_stop( td_t *td )
{
  int rc;
  byte_t ch;

  if( (rc = sigsetjmp(td->env, 1 )) == NO_ERROR ) {
    schreibe_byte_v2(td, STX);
    lese_byte_v2(td, &ch, DLE, 1);
    lese_byte_v2(td, &ch, ACK, 1);
    schreibe_byte_v2(td, S5_ONLINE_STOP);
    schreibe_byte_v2(td, DLE);
    schreibe_byte_v2(td, ETX);
    lese_byte_v2(td, &ch, DLE, 1);
    lese_byte_v2(td, &ch, ACK, 1);
    protokoll_stopp( td );
    return NO_ERROR;
  }
  td->errnr = rc;
  return 1;
}

int as511_ctrl_output_destroy( td_t *td, int (*usrfk)(void*) )
{
  void *d;

  if( td != NULL && td->dlh != NULL && td->dlh->dl_type == DL_TYPE_CTRL_OUTPUT ) {
    while( td->dlh->f != NULL ) {
      d = dlh_delete(td->dlh, td->dlh->l,DL_TYPE_CTRL_OUTPUT,usrfk,td->dlh->l->udata);
      Free(d);
    }
    Free(td->dlh);
    td->dlh = NULL;
    return NO_ERROR; // OK
  }
  return 1; // Fehler
}

int as511_ctrl_output_create( td_t *td )
{
  if( td != NULL && td->dlh == NULL ) {
    td->dlh = dlh_create( DL_TYPE_CTRL_OUTPUT );
    return NO_ERROR; // OK
  }
  return 1; // Fehler
}

void as511_ctrl_output_bl_free( td_t *td, copbl_t *bl )
{
  if( td->dlh->dl_type == DL_TYPE_CTRL_OUTPUT  && bl != NULL ) {
    Free(bl->badlst);
    Free(bl);
  }
}
