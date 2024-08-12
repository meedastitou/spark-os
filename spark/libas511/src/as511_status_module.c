/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_status_module.c
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


int as511_status_module_destroy( td_t *td, int (*usrfk)(void*) )
{
  void *d;

  if( td != NULL && td->dlh != NULL && td->dlh->dl_type == DL_TYPE_STATUS_MODULE ) {
    while( td->dlh->f != NULL ) {
      d = dlh_delete(td->dlh, td->dlh->l,DL_TYPE_STATUS_MODULE,usrfk,td->dlh->l->udata);
      Free(d);
    }
    Free(td->dlh);
    td->dlh = NULL;
    return 0; // OK
  }
  return 1; // Fehler
}

int as511_status_module_create( td_t *td )
{
  if( td != NULL && td->dlh == NULL ) {
    td->dlh = dlh_create( DL_TYPE_STATUS_MODULE );
    return 0; // OK
  }
  return 1; // Fehler
}

/*
  Funktion: int as511_status_module_insert_op( td_t *td,
                                                  unsigned char type,
                                                  unsigned short addr,
                                                  void *udata )
  Eingabeparameter:
    td_t *td:

    unsigned char type:
                Bausteintyp: OB, DB, PB, SB, ...

    unsigned short addr:
                Adresse des Speicherbereiches, dessen Status ermittelt werden soll.

    void *udata: Hier können Benutzerdefinierte Daten Stehen.

  Ausgabeparameter: NO_ERROR wenn die Funktion fehlerfrei ausgeführt wurde
                    ! NO_ERROR bei einem Fehler

  Einfügen von Operandentypen und Speicheradressen in die Liste
  in der Richtigen Reihenfolge. Die Reihenfolge muß mit der im Programmcode
  unbedingt übereinstimmen.
*/
int as511_status_module_insert_op( td_t *td, unsigned short type, unsigned short addr, void *udata )
{
  smd_u smd;
  dl_t  *dli;

  if( td->dlh != NULL ) {

    // Prüfe, ob die richtige Datenstruktur übergeben wurde.
    if( td->dlh->dl_type == DL_TYPE_STATUS_MODULE ) {
      smd.t.type = type; // Befehlstyp
      smd.t.addr = addr; // Startadresse

      dli = dlh_insert_last( td->dlh );
      if( dl_insert_data( td->dlh, dli, DL_TYPE_STATUS_MODULE, &smd, sizeof(smd), udata ) > 0 )
        return 1; // Fehler
    }
    return NO_ERROR; // OK
  }
  return 1; // Fehler
}

/*
  Funktion: int as511_status_module_start( td_t *td, sml_t *sml )

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur
                    offset Der Offset im Programmcode, innerhalb des Bausteins
                    bst_typ Der Bausteintyp (OB, FB. SB, DB, PB, FX, DX)
                    bst_nt Bausteinnummer 0-255

  Ausgabeparameter: 0 bei erfolg.
                    > 0 bei einnem Fehler
*/
int as511_status_module_start( td_t *td, unsigned short offset,
                               unsigned char bst_typ, unsigned char bst_nr )
{
  int rc;
  unsigned char ch;
  smd_u *smd;
  dl_t  *dl;

  td->errnr = NO_ERROR;

  if( td != NULL && td->dlh != NULL && td->dlh->f != NULL && td->dlh->dl_type == DL_TYPE_STATUS_MODULE ) {
    if( (rc = sigsetjmp(td->env, 1 )) == NO_ERROR ) {
      if( protokoll_start( td, S5_STATUS_BST ) ) {
        schreibe_daten_v2(td, HI(offset));
        schreibe_daten_v2(td, LO(offset));
        schreibe_daten_v2(td, 0x01); // ???
        schreibe_daten_v2(td, 0x00); // ???
        schreibe_daten_v2(td, bst_typ);
        schreibe_daten_v2(td, bst_nr);

        for( dl = td->dlh->f; dl != NULL; dl = dl->n ) {
          smd = DL_GET_DATA(smd_u, dl );
          schreibe_byte_v2(td,0x10);
          schreibe_byte_v2(td,UCHAR(smd->t.type));
          if( smd->t.type != STATUS_MODULE_NOPAR &&
              smd->t.type != STATUS_MODULE_LOAD  &&
              smd->t.type != STATUS_MODULE_LOAD_LARGE ) {
                schreibe_daten_v2(td,HI(smd->t.addr));
                schreibe_daten_v2(td,LO(smd->t.addr));
           }
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
        lese_byte_v2(td, &ch, 0, 0); // ???
        if( ch == 0x10 )
          lese_byte_v2(td, &ch, 0x10, 1); // ???
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ETX, 1);
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
      }
    }
    else {
      td->errnr = rc;
      return 1;
    }
  }
  return NO_ERROR;
}

static int status_module_run( td_t *td, unsigned char bef )
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
  Funktion: int as511_status_module_run( td_t *td, sml_t *sml )

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur

  Ausgabeparameter: NO_ERROR wenn die Funktion fehlerfrei ausgeführt wurde
                    ! NO_ERROR bei einem Fehler
*/
int as511_status_module_run( td_t *td )
{
  unsigned char ch;
  int rc;
  unsigned int index = 0;

  smd_u *smd;
  dl_t  *dl;

  td->errnr = 0;
  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( status_module_run( td, S5_ONLINE_START ) ) { // 0X80
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);

      lese_byte_v2(td, &ch, 0x00, 1); // ???
      lese_byte_v2(td, &ch, 0x00, 0); // ???
      lese_byte_v2(td, &ch, 0x00, 1); // ???

      index = as511_read_data( td );

      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, ACK);

      // Fuelle die Liste mit den Daten der Funktion
      // Status Module
      for( index = 0,dl = td->dlh->f; dl != NULL; dl = dl->n ) {
        smd = DL_GET_DATA(smd_u, dl );
        index = copy_module_data( td, index,  smd );
      }
    }
  }
  else {
    td->errnr = rc;
    return 1;
  }

  return 0;
}

/*
  Funktion: int as511_status_module_stop( td_t *td, sml_t *sml )

  Eingabeparameter: td  Zeiger auf die mit open_tty geoeffnete Datenstruktur

  Ausgabeparameter: NO_ERROR wenn die Funktion fehlerfrei ausgeführt wurde
                    ! NO_ERROR bei einem Fehler
*/
int as511_status_module_stop( td_t *td )
{
  int rc;

  td->errnr = NO_ERROR;

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( status_module_run( td, S5_ONLINE_STOP ) ) { // 0x81
      protokoll_stopp( td );
      return NO_ERROR;
    }
  }
  td->errnr = rc;
  return 1;
}
