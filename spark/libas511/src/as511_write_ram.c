/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_write_ram.c
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


// Daten vom PG ins AG übertragen
int as511_write_ram( td_t *td, unsigned short adr, unsigned short laenge, unsigned char *ptr )
{
  unsigned char ch;
  unsigned int index = 0;

  td->errnr = 0;

  /* Zur Zeit werden Maximal 512 byte geschrieben.
  Später wird es dieses Limit nicht mehr geben.
  */
  if( laenge > 512 )
    laenge = 512;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_WRITE_MEM ) ) {
      // Startadresse angeben
      schreibe_daten_v2(td, HI(adr));
      schreibe_daten_v2(td, LO(adr));
      // und dann die Daten
      for( index = 0; index < laenge; index++ ) {
        schreibe_daten_v2(td, ptr[index]);
      }
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      protokoll_stopp( td );
      return 1;
    }
  }
  return 0;
}


// Daten vom PG ins AG übertragen
int as511_write_ram32( td_t *td, unsigned long adr, unsigned long laenge, unsigned char *ptr )
{
  unsigned char ch;
  unsigned int index = 0;

  /* Zur Zeit werden Maximal 1024 byte geschrieben.
  Später wird es dieses Limit nicht mehr geben.
  */
  if( laenge > 1024 )
    laenge = 1024;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_WRITE_MEM ) ) {
      // Startadresse angeben
      schreibe_daten_v2(td, HI(LHI(adr)));
      schreibe_daten_v2(td, LO(LHI(adr)));
      schreibe_daten_v2(td, HI(LLO(adr)));
      schreibe_daten_v2(td, LO(LLO(adr)));
      // und dann die Daten
      for( index = 0; index < laenge; index++ ) {
        schreibe_daten_v2(td, ptr[index]);
      }
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      protokoll_stopp( td );
      return 1;
    }
  }
  return 0;
}
