/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   ustack.h
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

// Adressierung der Bits und Bytes innergalb des vom AG zurückgegebenen
// USTACK Speicherbereichs

#ifndef _USTACK_H
#define _USTACK_H

//typedef int bool;

struct ustack
{
  unsigned char *ptr;
  unsigned int   laenge;
};
typedef struct ustack ustack_t;

//bool get_ustack_status_bit( ustack_t *m, int byteno, int bitno );

#if 0
#define BSTSCH((m))  get_status_bit(m,1,5)
#define SCHTAE((m))  get_status_bit(m,1,4)
#define ADRBAU((m))  get_status_bit(m,1,3)
#define SPABBR((m))  get_status_bit(m,1,2)

#define CADA((m))    get_status_bit(m,2,7)
#define CEDA((m))    get_status_bit(m,2,6)
#define REMAN((m))   get_status_bit(m,2,5)
#endif

void   as511_read_ustack_free ( td_t *td, ustack_t *u );
ustack_t        *as511_read_ustack      ( td_t * td );

#endif
