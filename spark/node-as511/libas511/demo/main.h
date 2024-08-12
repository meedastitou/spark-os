/*
  Copyright (c) Peter Schnabel

  Datei:   main.h
  Datum:   12.08.2008
  Version: 0.0.0

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

typedef unsigned int u8;


// Zum Debuggen der Malloc Funktionen
extern int MallocZaehler;
extern MD md;

int dumpdata( unsigned char *ch, unsigned long size );
bs_t *lese_mc5( char *pfad );
int schreibe_mc5( char *pfad, bs_t *bst );
char * BstTypToString( u8 bsttyp );
int StringToBstTyp( char *bststring );
void SetTermBlockOff( int h );
void SetTermBlockOn( int h );
int SetTerm( void );
int ReSetTerm( void );
int KbHit( void );
int GetKey( void );
void PrintSystemParameter( syspar_t *sp );
void PrintModuleInfo( modinfo_t *mi );
int lese_system_parameter( td_t *td );
int ag_run( td_t *td );
int ag_stop( td_t *td );
int BstTransferAgFd( td_t *td, byte_t btyp, byte_t bnr, char *pfad );
int BstTransferFdAg( td_t *td, char *pfad );
int read_module_info( td_t *td, unsigned char bsttyp, unsigned char bstnr );
int test_write_module( td_t *td, bs_t *bst );
int read_module_addr_list( td_t *td, char *bsttyp );
int test_ram( td_t *td , dword_t start, dword_t size );
int test_compress( td_t *td );
int test_delete( td_t *td, unsigned char bsttyp, unsigned char bstnr );
int test_status_var( td_t *td, char *varlist );
int test_status_module( td_t *td, unsigned short offset, unsigned char bsttyp, unsigned char bstnr );
int test_bearbeitungskontrolle( td_t *td );
int test_ausgabe_steuern( td_t *td );
int test_read_bstack( td_t *td );
int test_read_ustack( td_t *td );
