/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_write_module.c
  Datum:   04.10.2006
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
#include <signal.h>
#include <string.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/poll.h>
#include <errno.h>
#define  _S5LIB_C_
#include <as511_s5lib.h>


/*
  Baustein vom PG ins AG Übertragen

  Es giebt zwei Befehl, Bausteine zu Übertragen. Das PG benutzt
  bei einer CPU 103 den Befehl 0x05 während der Befehl für ein AG
  928B 0x08 Lautet. Bei einer CPU 103 Funktioniert der Bedehl 0x08
  auch. Sollte es Probleme damit geben bitte ich um eine Nachricht.
*/
int as511_write_module(td_t *td,  bs_t *bst)
{
  syspar_t  *sp  = NULL; // Systemparameter

  unsigned char ch;
  unsigned int index = 0;

  unsigned char *ptr;
  unsigned char b;
  unsigned short bstlaenge;

  td->errnr = 0;

#if 1
  b = S5_WRITE_DB;
#else
  b = (bst->kopf.baustein_typ.btyp == DB) ? S5_WRITE_DB : S5_WRITE_BST;
#endif
  if( (sp = as511_read_system_parameter( td )) != NULL ) {
    if( sigsetjmp(td->env, 1 ) == 0 ) {
      if( protokoll_start( td, b ) ) {
        schreibe_daten_v2(td, UCHAR(bst->kopf.baustein_typ.btyp));
        schreibe_daten_v2(td, UCHAR(bst->kopf.baustein_nummer));
        schreibe_daten_v2(td, HI(bst->kopf.laenge));
        schreibe_daten_v2(td, LO(bst->kopf.laenge));
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ETX);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);
        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);
        lese_byte_v2(td, &ch, HT, 1);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ETX, 1);
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, ACK);
        schreibe_byte_v2(td, STX);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);
        schreibe_byte_v2(td, NUL);

        bstlaenge = USHORT(bst->laenge);
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&bst->kopf.laenge,&bst->kopf.laenge,sizeof(short));
#endif
        ptr = (unsigned char *) &bst->kopf;
        // Bausteinkopf uebertragen
        for( index = 0; index < sizeof(bs_kopf_t); index++ )  {
          schreibe_daten_v2(td, ptr[index]);
        }
        // Bausteincode uebertragen
        for( index = 0; index < (bstlaenge) - sizeof(bs_kopf_t); index++ ) {
          schreibe_daten_v2(td, bst->ptr[index]);
        }
        schreibe_byte_v2(td,DLE);       //  PG 0x10   DLE
        schreibe_byte_v2(td,EOT);       //  PG 0x04   EOT
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);
        protokoll_stopp( td );
        as511_read_system_parameter_free( td, sp );
        return 1;
      }
    }
    as511_read_system_parameter_free( td, sp );
  }
  return 0;
}
