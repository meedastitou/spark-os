/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_system_parameter.c
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

word_t as511_get_bst_addr_size( td_t *td, syspar_t *sp, byte_t bsttyp )
{
  word_t l;

  switch( bsttyp ) {
    case DB:
      l = sp->sp.Laenge_DB_liste;
      break;
    case SB:
      l = sp->sp.Laenge_SB_Liste;
      break;
    case PB:
      l = sp->sp.Laenge_PB_Liste;
      break;
    case FB:
      l = sp->sp.Laenge_FB_Liste;
      break;
    case OB:
      l = sp->sp.Laenge_OB_Liste;
      break;
    case DX:
      l = sp->sp.Laenge_DX_Liste;
      break;
    case FX:
      l = sp->sp.Laenge_FX_Liste;
      break;
    default:
      td->errnr = UNKNOWN_MODULE;
      l = 0;
      break;
  }
  return l;
}

/*
    21.08.2006
    Lesen der Systemparameter

    Eingabe:  td  Zeiger auf Datenstruktur
    Ausgabe:  Zeiger die Kopie der Systemparameter im PG
              NULL bei Fehler
*/
syspar_t * as511_read_system_parameter( td_t *td )
{
  unsigned char ch;
  syspar_t *syspar = NULL;

  td->errnr = 0;

  if( sigsetjmp(td->env, 1) == 0 ) {
    if( protokoll_start( td, S5_READ_SYSPAR ) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td , &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      lese_byte_v2(td, &ch, STX, 1);
      schreibe_byte_v2(td,DLE);
      schreibe_byte_v2(td,ACK);

      as511_read_data( td );

      schreibe_byte_v2(td,DLE);       //  PG 0x10   DLE
      schreibe_byte_v2(td,ACK);       //  PG 0x06   ACK

      if( protokoll_stopp( td ) ) {
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&td->mem[1],&td->mem[1],sizeof(sp_t) - 1);
#endif
        syspar = Malloc(sizeof(syspar_t));
        memcpy(&syspar->sp, &td->mem[1], sizeof(sp_t) );
        syspar->laenge = sizeof(sp_t);
        return syspar;
      }
    }
  }
  // Wenn das Programm bis hierher kommt, ist ein Fehler aufgetreten.
  as511_read_system_parameter_free( td, syspar );

  return NULL;
}

// Freigeben des Speichers
void as511_read_system_parameter_free( td_t * td, syspar_t * syspar )
{
  if( td && syspar )
    Free(syspar);
}
