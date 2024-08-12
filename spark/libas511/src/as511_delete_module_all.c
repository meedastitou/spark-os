/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_delete_module_all.c
  Datum:   21.10.2006
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


// Alle Baustein Loeschen
// Urlöschen AG
// Reset Overall
int as511_delete_module_all( td_t *td )
{
  int rc, PrtStart_rc;
  unsigned char ch;

  td->errnr = 0;

  if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
    if( (PrtStart_rc = protokoll_start( td, S5_DELETE_MODULE_ALL )) ) {
      schreibe_byte_v2(td, DLE);
      schreibe_byte_v2(td, EOT);
      lese_byte_v2(td, &ch, DLE, 1);
      lese_byte_v2(td, &ch, ACK, 1);
      protokoll_stopp( td );
      if( PrtStart_rc == CR ) {
        td->errnr = ERROR_AG_RUNING;
        return 0;
      }
      return 1;
    }
  }
  return rc;
}
