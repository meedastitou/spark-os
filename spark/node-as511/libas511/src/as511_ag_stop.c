/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_ag_stop.c
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
  AG STOP

  Die Funktion wurde auf einem AG100U CPU103 getestet.
*/
int as511_ag_stop( td_t *td )
{
  syspar_t  *sp  = NULL; // Systemparameter
  sps_ram_t *tmp = NULL; // SPS Speicherbereich

  if( (sp = as511_read_system_parameter( td )) != NULL ) {
    if( (tmp = as511_read_ram( td, USHORT (sp->sp.AddrSystemDaten + 12), 8 )) != NULL ) {
      tmp->ptr[0] |= SD_STOZUS; // Stop Sequenz
      tmp->ptr[1] |= SD_AF; // Alarmfreigabe OB2/OB13
      as511_write_ram( td, USHORT (sp->sp.AddrSystemDaten + 12), 2, tmp->ptr );
      as511_read_ram_free( td, tmp );
    }
    as511_read_system_parameter_free( td, sp );
  }
  return 1;
}
