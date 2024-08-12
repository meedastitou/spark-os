/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   as511_read_cpu_typ.c
  Datum:   26.11.2006
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
  Die Angaben sind beruhen teilweise auf vermutungen,
  da die entsprechende Hardeware nicht vorhanden ist.

  AG_100U CPU_090   "CPU 090"  ?
  AG_100U CPU_095   "CPU 095"  ?
  AG_100U CPU_100   "CPU 100"  ?
  AG_100U CPU_102   "CPU 102"  ?
  AG_100U CPU_103   "CPU 103"  Getestet Adresse 0XEA50
                               im Speicher der CPU (OK)

  AG_115U CPU_941   "CPU 941"  ?
  AG_115U CPU_942   "CPU 942"  ?
  AG_115U CPU_943   "CPU 943"  ?
  AG_115U CPU_944   "CPU 944"  ?
  AG_115U CPU_945   "CPU 945"  ?

  AG_135U CPU_921
  AG_135U CPU_922
  AG_135U CPU_928
  AG_135U CPU_928B  CPU Kennung 1 0x02 Getestet (OK)
                    CPU Kennung 2 0xB7
  AG_155U CPU_946   ?
  AG_155U CPU_947   ?
  AG_155U CPU_948   CPU Kennung 1 ?
                    CPU Kennung 2 0x82
  AG_155U CPU_948R  CPU Kennung 1 ?
                    CPU Kennung 2 0x83
*/

//
// CPU Typ und AG TYP ermitteln
// Wird für diverse Programmfunktionen benötigt.
// z.B für die ermittlung der Speicherorganisation Byte/Wort
//

#define AG_CPU100  "CPU 100"
#define AG_CPU102  "CPU 102"
#define AG_CPU103  "CPU 103"

#define AG_CPU941  "CPU 941"
#define AG_CPU942  "CPU 942"
#define AG_CPU943  "CPU 943"
#define AG_CPU944  "CPU 944"
#define AG_CPU945  "CPU 945"

#define AG_CPU921  "CPU 921"
#define AG_CPU922  "CPU 922"
#define AG_CPU928  "CPU 928"
#define AG_CPU928B "CPU 928B"

#define AG_CPU948  "CPU 948"
#define AG_CPU948R "CPU 948R"


ag_t ag100u[] = {
  { CPU100,AG100U,AG_CPU100 },
  { CPU102,AG100U,AG_CPU102 },
  { CPU103,AG100U,AG_CPU103 },
  { 0,0,NULL}
};

ag_t ag115u[] = {
  { CPU941,AG115U,AG_CPU941 },
  { CPU942,AG115U,AG_CPU942 },
  { CPU943,AG115U,AG_CPU943 },
  { CPU944,AG115U,AG_CPU944 },
  { CPU945,AG115U,AG_CPU945 },
  { 0,0,NULL}
};

ag_t ag135u[] = {
  { CPU921, AG135U,AG_CPU921  },
  { CPU922, AG135U,AG_CPU922  },
  { CPU928, AG135U,AG_CPU928  },
  { CPU928B,AG135U,AG_CPU928B },
  { 0,0,NULL}
};

ag_t ag155u[] = {
  { CPU948, AG155U,AG_CPU948  },
  { CPU948R,AG155U,AG_CPU948R },
  { 0,0,NULL}
};

// CPU Typ und AG TYP Ermitteln
ag_t *as511_get_ag_typ( td_t *td, syspar_t *sp )
{
  sps_ram_t *r;
  char      *cpu;
  int        i;
  ag_t      *ag = NULL;

  td->errnr = 0;

  switch( (sp->sp.CPU_Kennung & 0x03) ) {

    case 0x00: // CPU Kennung 1

      if((r = as511_read_ram( td, USHORT (sp->sp.AddrSystemDaten +80), 12 )) != NULL ) {

        cpu = Malloc(r->laenge + 1 );
        memcpy(cpu, r->ptr, 12);
        cpu[7] = '\0';

        switch( (sp->sp.CPU_Kennung2 & 0x0F) ) {

            case 0x01:   // AG100U
              for( i = 0; ag100u[i].cpu ; i++ ) {
                if(strncmp(cpu, ag100u[i].cpu, strlen(cpu) ) == 0 )
                  ag = &ag100u[i];
              }
              break;

            case 0x02:   // AG101U
              ag = NULL;
              break;

            case 0x03:   // AG105U
              ag = NULL;
              break;

            case 0x04:   // AG115U
              for( i = 0; ag115u[i].cpu ; i++ ) {
                if(strncmp(cpu, ag115u[i].cpu, strlen(cpu) ) == 0 )
                  ag = &ag115u[i];
              }
              break;

            default:
              ag = NULL;
              break;

        }
        as511_read_ram_free( td, r );
        Free(cpu);
      }
      break;

    case 0x02: // CPU Kennung 1

        switch( (sp->sp.CPU_Kennung2 & 0x0F) ) {

          case 0x07:   // AG135U

              switch( ((sp->sp.CPU_Kennung2 & 0xF0) ) ) {

                case 0xB0: // CPU 928B
                  ag = &ag135u[3];
                  break;

                case 0x10: // CPU922
                  ag = &ag135u[1];
                  break;

                default:
                  ag = NULL;
                  break;

              }
              break;

          case 0x08:  // AG155U

              switch( ((sp->sp.CPU_Kennung2 & 0xF0) ) ) {

                case 0x30: // CPU 948R
                  ag = &ag155u[1];
                  break;

                case 0x20: // CPU948
                  ag = &ag155u[0];
                  break;

                default:
                  ag = NULL;
                  break;

              }
              break;

          default:
            ag = NULL;
            break;

        }
        break;

    default:
      ag = NULL;
      break;

  }
  return ag;
}
