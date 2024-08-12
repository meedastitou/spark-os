/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_status_var.c
  Datum:   21.09.2006
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

int as511_status_var_destroy( td_t *td, int (*usrfk)(void*) )
{
  void *d;

  if( td != NULL && td->dlh != NULL && td->dlh->dl_type == DL_TYPE_STATUS_VAR ) {
    while( td->dlh->f != NULL ) {
      d = dlh_delete(td->dlh, td->dlh->l,DL_TYPE_STATUS_VAR,usrfk,td->dlh->l->udata);
      Free(d);
    }
    Free(td->dlh);
    td->dlh = NULL;
    return 0; // OK
  }
  return 1; // Fehler
}

int as511_status_var_create( td_t *td )
{
  if( td != NULL && td->dlh == NULL ) {
    td->dlh = dlh_create( DL_TYPE_STATUS_VAR );
    return 0; // OK
  }
  return 1; // Fehler
}

/*
  Funktion: dl_t *as511_status_var_insert_type( td_t *td,
                                                unsigned char type,
                                                unsigned short addr,
                                                int (*usrfk)(void*),
                                                void *udata )

  Eingabeparameter: td    = Datenstruktur für AS511 Protokoll
                    type  = STATUS_VAR_DATEN für Timer, Zähler und Datenworte
                    addr  = Adresse im Speicherbereich der CPU
                            STATUS_VAR_MERKER für den Merkerbereich
                    usrfk = Zeiger auf eine Benutzerdefinierte Funktion, die bei
                            einem Fehler in der Funktion aufgerufen wird. Mit
                            dieser Funktion kann man z.B. den Speicher "udata"
                            freigeben.
                    udata = Zeiger auf Benutzerdefienierte Daten
  Ausgabeparameter: dl_t    Zeiger auf den Knoten "dl", der neu erzeugt wurde.

  Funktion:         Erzeugt einen neuen Knoten "dl" der die Daten für STATUS VAR
                    enthält.

*/
dl_t *as511_status_var_insert_type( td_t *td, unsigned char type, unsigned short addr, int (*usrfk)(void*), void *udata )
{

  svd_u svd;
  dl_t  *dl = NULL;

  svd.t.type = type;
  svd.t.addr = addr;

  if( td->dlh->dl_type == DL_TYPE_STATUS_VAR ) {
    dl = dlh_insert_last( td->dlh );
    if( dl_insert_data( td->dlh, dl, DL_TYPE_STATUS_VAR, &svd, sizeof(svd_u), udata ) > 0 ) {
      dlh_delete( td->dlh, dl, DL_TYPE_STATUS_VAR, usrfk, udata);
      return NULL;
    }
  }
  return dl;
}

/*
  Funktion:

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur

  Ausgabeparameter:

*/
int as511_status_var_start( td_t *td )
{
  svd_u *svd;
  dl_t  *dl;
  int rc;
  unsigned char ch;

  if( td == NULL || td->dlh == NULL )
    return 0;

  td->errnr = 0;

  if( td->dlh->f == NULL ) {       // Ohne "s" keine Daten
    td->errnr = STATUS_NO_DATA;
    return 0;
  }

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( protokoll_start( td, S5_STATUS_VAR ) ) {
      schreibe_daten_v2(td, 0x00); // ???
      schreibe_daten_v2(td, 0x00); // ???
      schreibe_daten_v2(td, 0x00); // ???
      schreibe_daten_v2(td, 0x00); // ???
      schreibe_daten_v2(td, 0x10); // ??? Könnte die Puffergröße sein 4160 Byte ?
      schreibe_daten_v2(td, 0x3F); // ??? 0x103F = 4159 (0-4159) = 4160 Byte ?
                                   // ??? Andererseits wird 0x10 als Datenbyte
                                   // ??? immer doppelt geschrieben. Aber 0x3F
                                   // ??? gehört nicht zum AS511 Protokoll ???
      for( dl = td->dlh->f; dl != NULL; dl = dl->n ) {
        svd = DL_GET_DATA(svd_u, dl );
        schreibe_byte_v2(td,0x10);
        schreibe_byte_v2(td,UCHAR(svd->t.type));
        schreibe_byte_v2(td,HI(svd->t.addr));
        schreibe_byte_v2(td,LO(svd->t.addr));
      }
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);

      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);
      // Diese 0x10 ist immer da
      // Wofuer ????????????????
      lese_byte_v2(td, &ch, 0x10, 1); // ??? Vielleicht ein Fehlercode ???
      lese_byte_v2(td, &ch, 0x10, 1); // ???
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ETX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);
    }
  }
  else {
    td->errnr = rc;
    return 0;
  }

  return 1;
}

static int status_var_run( td_t *td, unsigned char bef )
{
  unsigned char ch;

  schreibe_byte_v2(td, STX);
  lese_byte_v2(td, &ch, DLE, 1);
  lese_byte_v2(td, &ch, ACK, 1);
  schreibe_byte_v2(td, bef);      // Befehlsnummer (0x80, 0x81)
  schreibe_byte_v2(td, DLE);
  schreibe_byte_v2(td, ETX);
  lese_byte_v2(td, &ch, DLE, 1);
  lese_byte_v2(td, &ch, ACK, 1);

  return 1;
}

/*
  Funktion:

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur


  Ausgabeparameter:
*/
int as511_status_var_run( td_t *td )
{
  unsigned char ch;
  int rc;
  svd_u *svd;
  dl_t  *dl;
  unsigned int index = 0;

  td->errnr = 0;

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( status_var_run( td, S5_ONLINE_START ) ) { // 0X80
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);

      lese_byte_v2(td, &ch, 0x00, 1); // ???
      lese_byte_v2(td, &ch, 0x00, 0); // AG RUN = 0xFF, STOP = 0x00
      lese_byte_v2(td, &ch, 0x00, 1); // ???

      index = as511_read_data( td );

      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);

      // Daten nur in der Liste Speichern, wenn
      // die Liste gueltige Adresse enthaelt.
      if( td->dlh != NULL ) {
        // Fuelle die Liste mit den Daten der Funktion
        // Status Var
        index = 0;
        for( dl = td->dlh->f ; dl != NULL; dl = dl->n ) {
          svd = DL_GET_DATA(svd_u, dl );
          switch( svd->t.type ) {
            case STATUS_VAR_PAE:
            case STATUS_VAR_PAA:
            case STATUS_VAR_MERKER:
              memcpy(&svd->t4.status_0, &td->mem[index], 4 );
              index += 4;
              break;
            case STATUS_VAR_ZAEHLER:
            case STATUS_VAR_DATEN:
              memcpy(&svd->t6.status_0, &td->mem[index], 6 );
              index += 6;
  #if __BYTE_ORDER == __LITTLE_ENDIAN
              swab(&svd->t6.w.d.wert,&svd->t6.w.d.wert,sizeof(short));
  #endif
              break;
          }
        }
      }
    }
  }
  else {
    td->errnr = rc;
  }
  return 0;
}

/*
  Funktion: int as511_status_var_stop( td_t *td, svl_t *svl )

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur

  Ausgabeparameter: 1, wenn die Funktion Fehlerfrei ausgeführt wurde,
                    0 bei einem Fehler.
*/
int as511_status_var_stop( td_t *td )
{
  int rc;

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( status_var_run( td, S5_ONLINE_STOP ) ) { // 0x81
      protokoll_stopp( td );
      return 1;
    }
  }
  td->errnr = rc;
  return 0;
}
