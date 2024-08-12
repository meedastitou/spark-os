/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_change_operating_mode.c
  Datum:   28.02.2007
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
  Wechselt die CPU in den Zustand
  STOP                      S5_CH_OP_MODE_STOP
  RUN mittels Neustart      S5_CH_OP_MODE_RESTART
  RUN mittels Wiederanlauf  S5_CH_OP_MODE_REBOOT

  Diese Funktion wurde auf einer CPU 928B (AG135U) getestet.
  vermutlich Läuft sie auch auf einer AG155U mit CPU 948(R)

  Die kleineren AG100U funktioniern nicht.
  Das AG115U konnte mangels Hardware nicht getestet werden.
*/
int as511_change_operating_mode( td_t *td, unsigned char mode )
{
  int rc;
  unsigned char ch;

  switch( mode )
  {
    case S5_CH_OP_MODE_STOP:
    case S5_CH_OP_MODE_RESTART:
    case S5_CH_OP_MODE_REBOOT:
      if( (rc = sigsetjmp(td->env, 1 )) == 0 ) {
        if( protokoll_start( td, S5_CH_OP_MODE ) ) {
          schreibe_byte_v2(td, mode);
          schreibe_byte_v2(td, DLE);
          schreibe_byte_v2(td, EOT);
          lese_byte_v2(td, &ch, DLE, 1);
          lese_byte_v2(td, &ch, ACK, 1);
          if( mode == S5_CH_OP_MODE_RESTART || mode == S5_CH_OP_MODE_REBOOT ) {
            lese_byte_v2(td, &ch, STX, 1);
            schreibe_byte_v2(td, DLE);
            schreibe_byte_v2(td, ACK);
            lese_byte_v2(td, &ch, 0, 0);  // Rückgabewert = 0x25 oder 0x26
            rc = ch;                      // je nach mode
            lese_byte_v2(td, &ch, DLE, 1);
            lese_byte_v2(td, &ch, ETX, 1);
            schreibe_byte_v2(td, DLE);
            schreibe_byte_v2(td, ACK);
          }
          protokoll_stopp( td );
          td->errnr = 0;
          return 1;
        }
      }
      break;
    default:
      td->errnr = BAD_PARAMETER;
      return 0;
  }
  td->errnr = rc;
  return 0;
}
