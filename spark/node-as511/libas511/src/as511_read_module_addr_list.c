/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_module_addr_list.c
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


// Baustein Adressliste Lesen
// Bausteintyp (bst_typ) ist eine der Konstanten DB, PB, FB, OB, ...
bal_t  *as511_read_module_addr_list( td_t *td, unsigned char bst_typ )
{
  bal_t *bal = NULL;
  syspar_t *sp;
  word_t l;

  unsigned char ch;
  unsigned int index = 0;

  td->errnr = 0;

  if( (sp = as511_read_system_parameter( td )) != NULL ) {
    if((l = as511_get_bst_addr_size( td, sp, bst_typ )) > 0 ) {
      if( sigsetjmp(td->env, 1) == 0 ) {
        if( protokoll_start( td, S5_READ_BST_ADDR_LIST ) ) {
          schreibe_daten_v2(td, bst_typ);
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

          if (protokoll_stopp( td ) ) {
            index--;
            bal = Malloc( sizeof( bal_t ) );
            bal->ptr = Malloc( l );

            memcpy(bal->ptr, &td->mem[1], l );
            bal->laenge = l;
#if __BYTE_ORDER == __LITTLE_ENDIAN
            swab(bal->ptr, bal->ptr, l );
#endif
            as511_read_system_parameter_free( td, sp );
            return bal;
          }
        }
      }
    }
  }
  as511_read_system_parameter_free( td, sp );
  return NULL;
}

// Speicher Freigeben
void  as511_read_module_addr_list_free( td_t *td, bal_t *bal )
{
  if( td != NULL && bal != NULL ) {
    if( bal->ptr != NULL ) {
      Free(bal->ptr);
    }
    Free(bal);
  }
}
