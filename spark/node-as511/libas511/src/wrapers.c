/*
  Copyright (c) Peter Schnabel

  Datei: wrapers.c
  Datum: 03.09.2006
  Version: $Revision: 1.4 $

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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#include <as511_s5lib.h>
#include <as511_mem.h>

#define MEM_TEST 0

int MallocZaehler;


MD md;

void *Malloc( size_t size )
{
  void *p;
#if defined MEM_TEST && MEM_TEST > 0
  ML *mli, *t;
#endif
  if( (p = malloc(size)) == NULL )
  {
    perror("Out of Memory");
    abort();
  }

  memset(p,0x00,size);
  MallocZaehler++;
#if defined MEM_TEST && MEM_TEST > 0
  if( ++md.debug ) {
    if( (mli = malloc(sizeof(ML))) != NULL ) {
      memset(mli,0x00,sizeof(ML));
      mli->ptr = (int)p;
      mli->size = size;
      printf("%8d",MallocZaehler);
      printf("Malloc allocate size %6d bytes at %p\n", size, p );
      if( md.mlf == NULL ) {
        md.mll = md.mlf = mli;
      }
      else {
        t = md.mlf;
        mli->n = t;
        t->v = mli;
        md.mlf = mli;
      }
    }
  }
#endif
  return p;
}

void Free( void *p )
{
#if defined MEM_TEST && MEM_TEST > 0
  ML *mli;
#endif
  if( p == NULL )
    return;
#if defined MEM_TEST && MEM_TEST > 0
  for( mli = md.mlf; mli; mli = mli->n ) {
    if( p == (void*)mli->ptr ) {
      mli->isfree = 1;
      printf("Free %6d byted at %p\n",mli->size, p );
      break;
    }
  }
#endif
  MallocZaehler--;
  free(p);
}
