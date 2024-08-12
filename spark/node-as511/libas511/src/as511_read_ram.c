/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_ram.c
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

// Speicherinhalte vom AG ins PG übertragen
sps_ram_t * as511_read_ram( td_t *td, unsigned short adr, unsigned short laenge )
{
  sps_ram_t *tmp = NULL;
  unsigned char ch;
  unsigned int index = 0;

  td->errnr = 0;

  /* Zur Zeit werden Maximal 512 byte gelesen.
  */
  if( laenge > 512 )
    laenge = 512;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_READ_MEM ) ) {
      schreibe_daten_v2(td, HI(adr));
      schreibe_daten_v2(td, LO(adr));
      schreibe_daten_v2(td, HI(adr+laenge-1));
      schreibe_daten_v2(td, LO(adr+laenge-1));
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td,DLE);
      schreibe_byte_v2(td,ACK);
      index = as511_read_data( td );
      schreibe_byte_v2(td,DLE);       //  PG 0x10   DLE
      schreibe_byte_v2(td,ACK);       //  PG 0x06   ACK

      index -= 5; // Die Ersten 5 Zeichen sid offensichtlich Datenmuell ???

      if (protokoll_stopp( td ) ) {
        tmp = Malloc(sizeof(sps_ram_t));
        tmp->ptr = Malloc(index);
        tmp->laenge = index;
        memcpy(tmp->ptr, &td->mem[5], index);
        return tmp;
      }
    }
  }
  as511_read_ram_free( td, tmp );
  return NULL;
}

// Speicherinhalte vom AG ins PG übertragen
sps_ram_t * as511_read_ram32( td_t *td, unsigned long adr, unsigned long laenge )
{
  sps_ram_t *tmp = NULL;
  unsigned char ch;
  unsigned int index = 0;

  /* Zur Zeit werden Maximal 512 byte gelesen.
   */
  if( laenge > 512 )
    laenge = 512;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_READ_MEM ) ) {
      schreibe_daten_v2(td, HI(LHI(adr)));
      schreibe_daten_v2(td, LO(LHI(adr)));
      schreibe_daten_v2(td, HI(LLO(adr)));
      schreibe_daten_v2(td, LO(LLO(adr)));
      schreibe_daten_v2(td, HI(LHI(adr+laenge-1)));
      schreibe_daten_v2(td, LO(LHI(adr+laenge-1)));
      schreibe_daten_v2(td, HI(LLO(adr+laenge-1)));
      schreibe_daten_v2(td, LO(LLO(adr+laenge-1)));
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td,DLE);
      schreibe_byte_v2(td,ACK);
      index = as511_read_data( td );
      schreibe_byte_v2(td,DLE);
      schreibe_byte_v2(td,ACK);

      index -= 9; // Die Ersten 9 Zeichen sid offensichtlich Datenmuell ???

      if (protokoll_stopp( td ) ) {
        tmp = Malloc(sizeof(sps_ram_t));
        tmp->ptr = Malloc(index);
        tmp->laenge = index;
        memcpy(tmp->ptr, &td->mem[9], index);
        return tmp;
      }
    }
  }
  as511_read_ram_free( td, tmp );
  return NULL;
}

void  as511_read_ram_free( td_t *td, sps_ram_t *sr )
{
  if( td != NULL && sr != NULL ) {
    if( sr->ptr ) {
      Free(sr->ptr);
    }
    Free(sr);
  }
}
