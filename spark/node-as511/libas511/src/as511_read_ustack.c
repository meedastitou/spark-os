/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_ustack.c
  Datum:   01.03.2007
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


// Ustack lesen
//
// Die Verschiedenen CPU Typen liefern vermutlich unterschidliche Informationen.
// Deshalb sollte im Handbuch des AG nachgelesen werden, wie der Speicherbereich
// aufgebaut ist.

// Die Verschiedenen Ustack Tiefen werden in dieser Funktion nicht erkannt.

ustack_t *as511_read_ustack( td_t * td )
{
  byte_t ch;
  ustack_t *u = NULL;
  int PrtStart_rc;
  unsigned int index = 0;

  td->errnr = 0;
  if( sigsetjmp(td->env, 1 ) == 0 ) {
    if( (PrtStart_rc = protokoll_start( td, S5_READ_USTACK )) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);

      if( PrtStart_rc != CR ) {
        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);

        index = as511_read_data( td );

        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);

        // Das Erste Zeichen ist offensichtlich Datenmuell ???
        if( --index ) {
          u = Malloc(sizeof(ustack_t));
          u->ptr = Malloc(index);
          u->laenge = index;
          memcpy(u->ptr, &td->mem[1], index);
        }
        else
          td->errnr = STACK_EMPTY;
      }
      else {
        td->errnr = ERROR_AG_RUNING;
      }

      if( protokoll_stopp( td ) ) {
        return u;
      }
    }
  }
  as511_read_ustack_free( td, u );
  return NULL;
}

// Ustack Speicher Freigeben
void  as511_read_ustack_free( td_t *td, ustack_t *u )
{
  if( td && u ) {
    if( u->ptr ) {
      Free(u->ptr);
    }
    Free(u);
  }
}
