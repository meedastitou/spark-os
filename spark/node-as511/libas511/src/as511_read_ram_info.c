/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_ram_info.c
  Datum:   29.10.2006
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

   Lesen von Ramadressen

   Die Adresse beinhalten die Startddresse des AG Ram sowie den
   ersten freien Speicherplatz im Ram. Die Endadresse stammt aus
   den Systemdaten.

*/
raminfo_t *as511_read_ram_info( td_t *td )
{
  syspar_t  *sp;
  int index = 0;
  unsigned char ch;
  raminfo_t *tmp = NULL;

  td->errnr = 0;

  if( (sp = as511_read_system_parameter(td)) != NULL ) {
    if( sigsetjmp(td->env, 1) == 0 ) {
      if( protokoll_start( td, S5_READ_RAM_INFO ) ) {
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

        if( index > 0 ) {
          index -= 1; // Das Erste Zeichen ist offensichtlich Datenmuell ???
        }

        if (protokoll_stopp( td ) ) {
          tmp = Malloc(sizeof(raminfo_t));
          memcpy(tmp, &td->mem[1], index);
#if __BYTE_ORDER == __LITTLE_ENDIAN
          swab(tmp, tmp, index );
#endif
          tmp->end_ram = sp->sp.AddrEndRam;
        }
      }
    }
    as511_read_system_parameter_free( td, sp );
  }
  return tmp;
}
