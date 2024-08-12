/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_prog_module.c
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
  Baustein vom AG ins PG übertragen
*/
bs_t *as511_read_module( td_t *td,  unsigned char btyp, unsigned char bnr )
{
  syspar_t  *sp  = NULL; // Systemparameter
  bs_t *bst = NULL;

  unsigned char ch;
  unsigned int index = 0;

  td->errnr = 0;

  if( (sp = as511_read_system_parameter( td )) != NULL ) {
    if( sigsetjmp(td->env, 1 ) == 0 ) {
      if( protokoll_start( td, S5_READ_BST ) ) {
        schreibe_daten_v2(td, btyp);
        schreibe_daten_v2(td, bnr);
        schreibe_byte_v2(td, DLE);
        schreibe_byte_v2(td, EOT);
        lese_byte_v2(td, &ch, DLE, 1);
        lese_byte_v2(td, &ch, ACK, 1);
        lese_byte_v2(td, &ch, STX, 1);
        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);

        index =  as511_read_data( td );

        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);

        // Das Erste Zeichen ist NUL ??
        // Dann folgt der Bausteinkopf
        index -= (1 + sizeof(bs_kopf_t));

        if (protokoll_stopp( td ) ) {
          if( index > 0 ) {
            bst = Malloc(sizeof(bs_t));
            memcpy(&bst->kopf, &td->mem[1], sizeof(bs_kopf_t));
#if __BYTE_ORDER == __LITTLE_ENDIAN
            swab(&bst->kopf.laenge,&bst->kopf.laenge,sizeof(short));
#endif
            bst->laenge = bst->kopf.laenge * sizeof(short);
            bst->ptr = Malloc(bst->laenge - sizeof(bs_kopf_t));
            memcpy(bst->ptr, &td->mem[1 + sizeof(bs_kopf_t)], bst->laenge - sizeof(bs_kopf_t));
            as511_read_system_parameter_free( td, sp );
            return bst;
          }
        }
      }
    }

    as511_module_mem_free( td, bst );
    as511_read_system_parameter_free( td, sp );
  }
  return NULL;
}

// Freigeben des Speichers
void  as511_read_module_free( td_t * td, bs_t *bst )
{
  if( td ) {
    if( bst && bst->ptr ) {
      Free(bst->ptr);
      Free(bst);
    }
  }
}
