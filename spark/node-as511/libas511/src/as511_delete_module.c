/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_delete_module.c
  Datum:   20.10.2006
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

// Baustein Loeschen
int as511_delete_module( td_t *td, unsigned char bst_typ, unsigned char bst_nr )
{
  int PrtStp_rc;
  unsigned char ch;

  td->errnr = 0;

  if( sigsetjmp(td->env, 1 ) == 0 ) {
    if( protokoll_start( td, S5_DELETE_MODULE ) ) {
      schreibe_daten_v2(td, bst_typ );
      schreibe_daten_v2(td, bst_nr );
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      PrtStp_rc = protokoll_stopp( td );

      if( PrtStp_rc == DC4 ) {
        PrtStp_rc = protokoll_stopp( td );
        td->errnr = MODULE_NOT_PRESENT;
        return 0;
      }
      return 1;
    }
  }
  return 0;
}
