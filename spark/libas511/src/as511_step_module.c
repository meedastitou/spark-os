/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_step_module.c
  Datum:   26.04.2007
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
#include <semaphore.h>
#include <stdio.h>
#include <fcntl.h>
#define __USE_XOPEN
#include <unistd.h>
#include <termios.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/poll.h>
#include <errno.h>
#define  _S5LIB_C_
#include <as511_s5lib.h>

int as511_step_module_destroy( td_t *td, int (*usrfk)(void*) )
{
  void *d;

  if( td != NULL && td->dlh != NULL && td->dlh->dl_type == DL_TYPE_STEP_MODULE ) {
    while( td->dlh->f != NULL ) {
      d = dlh_delete(td->dlh, td->dlh->l,DL_TYPE_STEP_MODULE,usrfk,td->dlh->l->udata);
      Free(d);
    }
    Free(td->dlh);
    td->dlh = NULL;
    return 0; // OK
  }
  return 1; // Fehler
}

int as511_step_module_create( td_t *td )
{
  if( td != NULL && td->dlh == NULL ) {
    td->dlh = dlh_create( DL_TYPE_STEP_MODULE );
    return 0; // OK
  }
  return 1; // Fehler
}

// Datenliste erstellen, die dem auszuführendem Programmcode entspricht.
// Wird für die Weitere Abarbeitung benötigt.
int as511_step_module_insert_op( td_t *td, unsigned short type, unsigned short addr, void *udata )
{
  smd_u smd;
  dl_t  *dli;

  if( td->dlh != NULL ) {

    // Prüfe, ob die richtige Datenstruktur übergeben wurde.
    if( td->dlh->dl_type == DL_TYPE_STEP_MODULE ) {
      smd.t.type = type; // Befehlstyp
      smd.t.addr = addr; // Startadresse

      dli = dlh_insert_last( td->dlh );
      if( dl_insert_data( td->dlh, dli, DL_TYPE_STEP_MODULE, &smd, sizeof(smd), udata ) > 0 ) {
        return 1; // Fehler
      }
    }
    return 0; // OK
  }
  return 1; // Fehler
}

/*

    Funktion: Bearbeitungskontrolle

    Ausführen des STEP5 Codes Schrittweise

    as511_step_module_init(...)       Schaltet die Bearbeitungskontrolle ein.
    as511_step_module_start(...)      Ersten Haltepunkt anspringen und 1. Befehl ausführen.
    as511_step_module_continue(...)   Weitere Haltepunkte Anspringen und Befehl Ausführen.
    as511_step_module_stop(...)       Schaltet die Bearbeitungskontrolle aus.
*/


int as511_step_module_init( td_t *td )
{
  int rc;
  unsigned char ch;
  // Parameter Prüfen
  if( td == NULL ){
    return -1;
  }

  td->errnr = 0;
  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( protokoll_start( td, S5_DEBUG_INIT ) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      protokoll_stopp( td );
    }
  }
  return rc;
}



dl_t *as511_step_module_start( td_t *td, unsigned short offset, unsigned char bst_typ, unsigned char bst_nr )
{
  dl_t *dl;
  smd_u *smd;
  int rc;
  unsigned char ch;

  td->errnr = 0;

  if( td != NULL && td->dlh != NULL && td->dlh->f != NULL && td->dlh->dl_type == DL_TYPE_STEP_MODULE ) {
    dl = td->dlh->f;
    smd = DL_GET_DATA(smd_u, dl );
    if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
      if( protokoll_start( td, S5_DEBUG_START ) ) {
        schreibe_daten_v2(td, HI(offset));
        schreibe_daten_v2(td, LO(offset));
        schreibe_daten_v2(td, 0x01); // ???
        schreibe_daten_v2(td, 0x00); // ???
        schreibe_daten_v2(td, bst_typ);
        schreibe_daten_v2(td, bst_nr);

        schreibe_byte_v2(td,0x10);
        schreibe_byte_v2(td,UCHAR(smd->t.type));
        if( smd->t.type != DEBUG_MODULE_NOPAR &&
            smd->t.type != DEBUG_MODULE_LOAD  &&
            smd->t.type != DEBUG_MODULE_LOAD_LARGE ) {
          schreibe_daten_v2(td,HI(smd->t.addr));
          schreibe_daten_v2(td,LO(smd->t.addr));
        }
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, EOT);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);

        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);

        as511_read_data( td );

        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
        protokoll_stopp( td );
      }
      // Daten Aufbereiten
      copy_module_data( td, 3, smd );
      return dl;
    }
    else {
      td->errnr = rc;
      return NULL;
    }
  }
  return NULL;
}


dl_t *as511_step_module_continue( td_t *td, dl_t *dl )
{
  smd_u *smd;
  unsigned char ch;
  dl_t *dli;

  td->errnr = 0;

  // Parameter Prüfen
  if( td == NULL || td->dlh == NULL || dl == NULL || td->dlh->dl_type != DL_TYPE_STEP_MODULE) {
    return NULL;
  }

  // ist dl in der Liste dlh
  for( dli = td->dlh->f; dli; dli = dli->n ) {
    if( dl == dli)
      break;
  }

  if( dli == NULL )
    return NULL;

  // Daten Prüfen
  if( (smd = DL_GET_DATA(smd_u, dl )) != NULL ) {

    // Protokollablauf Starten
    if( sigsetjmp(td->env, 1) == 0 ) {
      if( protokoll_start( td, S5_DEBUG_CONTINUE ) ) {
        schreibe_byte_v2(td,0x10);
        schreibe_byte_v2(td,UCHAR(smd->t.type));
        if( smd->t.type != STATUS_MODULE_NOPAR &&
            smd->t.type != STATUS_MODULE_LOAD  &&
            smd->t.type != STATUS_MODULE_LOAD_LARGE ) {
            schreibe_daten_v2(td,HI(smd->t.addr));
            schreibe_daten_v2(td,LO(smd->t.addr));
        }
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, EOT);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);

        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td, DLE );
        schreibe_byte_v2(td, ACK );

        as511_read_data( td );

        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
        protokoll_stopp( td );
      }
      copy_module_data( td, 1, smd );
    }
  }
  return dl;
}


int as511_step_module_stop( td_t *td )
{
  int rc;
  unsigned char ch;
  // Parameter Prüfen
  if( td == NULL ){
    return -1;
  }

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    schreibe_byte_v2(td, STX);
    lese_byte_v2(td, &ch, DLE, 1);
    lese_byte_v2(td, &ch, ACK, 1);
    schreibe_daten_v2(td, S5_ONLINE_STOP );      // Befehlsnummer
    schreibe_byte_v2(td, DLE);
    schreibe_byte_v2(td, ETX);
    lese_byte_v2(td, &ch, DLE, 1);
    lese_byte_v2(td, &ch, ACK, 1);

    protokoll_stopp( td );
  }
  td->errnr = rc;
  return 0;
}
