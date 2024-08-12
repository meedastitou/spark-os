/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_bstack.c
  Datum:   02.01.2007
  Version: 0.0.1

  This program is free software; you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation; either version 2 of the License.

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

bstack_t *as511_read_bstack( td_t * td )
{
  byte_t ch;
  bstack_t *b = NULL;
  int PrtStart_rc;
  unsigned int index = 0;

  td->errnr = 0;
  if( sigsetjmp(td->env, 1) == 0 ) {
    if( (PrtStart_rc = protokoll_start( td, S5_READ_BSTACK )) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);

      if( PrtStart_rc != CR ) {
        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);

        index =  as511_read_data( td );

        schreibe_byte_v2(td,DLE);       //  PG 0x10   DLE
        schreibe_byte_v2(td,ACK);       //  PG 0x06   ACK

        // Das Erste Zeichen ist ein Rückgabewert oder Datenmuell ???
        if( --index ) {
          b = Malloc(sizeof(bstack_t));
          b->ptr = Malloc(index);
          b->laenge = index / sizeof(bstackfmt);
          memcpy(b->ptr, &td->mem[1], index);
#if __BYTE_ORDER == __LITTLE_ENDIAN
          swab(b->ptr,b->ptr, index);
#endif
        }
        else
          td->errnr = STACK_EMPTY;
      }
      else {
        td->errnr = ERROR_AG_RUNING;
      }

      if( protokoll_stopp( td ) ) {
        return b;
      }
    }
  }
  as511_read_bstack_free( td, b );
  return NULL;
}

void  as511_read_bstack_free( td_t *td, bstack_t *b )
{
  if( td && b ) {
    if( b->ptr ) {
      Free(b->ptr);
    }
    Free(b);
  }
}
