/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_module_info.c
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

// Baustein Buchhalter lesen
modinfo_t *as511_read_module_info( td_t *td, unsigned char bst_typ, unsigned char bst_nr )
{
  modinfo_t *bh = NULL;
  unsigned char ch;

  td->errnr = 0;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_READ_BOOKMARKER ) ) {
      bh = Malloc(sizeof(buchhalter_t));
      schreibe_daten_v2(td, bst_typ);
      schreibe_daten_v2(td, bst_nr);
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td,DLE);
      schreibe_byte_v2(td,ACK);

      as511_read_data( td );

      schreibe_byte_v2(td,DLE);       //  PG 0x10   DLE
      schreibe_byte_v2(td,ACK);       //  PG 0x06   ACK

      if (protokoll_stopp( td ) ) {
        memcpy(bh, &td->mem[1], sizeof(modinfo_t));
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&bh->ram_adresse, &bh->ram_adresse, sizeof(unsigned short));
        swab(&bh->laenge, &bh->laenge, sizeof(unsigned short));
#endif
        return bh;
      }
    }
  }
  as511_read_module_info_free( td, bh );
  return NULL;
}

// Freigeben des Speichers
void  as511_read_module_info_free( td_t * td, modinfo_t * mi )
{
  if( td && mi )
    Free(mi);
}
