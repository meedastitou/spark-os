/*
  Copyright (c) 2002-2009 Peter Schnabel

  Datei:   s5lib.c
  Datum:   03.09.2006
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

#define DEBUG(x,y)  fprintf(td->debug_handle,(x),(y));

/*
  lese_byte_v2

  Liest ein Zeichen von dem Dateihandle td->fd

  Eingabe:
    td:       Zeiger auf eine mit open_tty erzeugte Datenstruktur
    ch:       Zeiger auf das gelesene Zeichen
    test_ch:  Mit diesem Parameter ist es möglich, das gelesene Zeichen
              zu Pruefen. Wird z.B. DLE erwatet, aber EOT gelesen, wird
              die Funktion mit dem Fehlercode CHAR_UNKNOWN 0x8001 ueber
              siglongjmp verlassen.
    test_enable:
              Damit wird der Test EIN > 0 oder AUS = 0 geschaltet.

  Ausgabe:    Rueckgabewert von poll() wenn die Funktion fehlerfrei
              ausgeführt wurde

  Fehlerbehandlung:
    Die Funktion kehrt nicht zum Aufrufer zurück, wenn ein Fehler auftritt.
    Die Funktionen schreibe_byte_v2 und lese_byte_v2 springen zu dem Punkt,
    der mit sigsetjmp definiert wurde.

    poll wartet maximal td->timeout Millisekunden. Dann wird SPS_TIMEOUT
    gesetzt und wie oben beschrieben an den Punkt, der mit sigsetjmp
    definiert wurde, gesprungen.
*/
int lese_byte_v2( td_t *td, unsigned char *ch, unsigned char test_ch, int test_enable )
{
  int rc;
  struct pollfd  pfd;

  pfd.fd = td->fd;
  pfd.events = POLLIN;

  errno = 0; // Errno zurücksetzen

  if( (rc = poll(&pfd, 1, td->timeout)) > 0 ) {
    read(td->fd,ch,1);

    if( td->debug_level >= DEBUG_LEVEL_AS511_ALL ) {
      DEBUG("\tAG -> PG %02X\n", *ch );
    }

    if( test_enable && *ch != test_ch ) {
      if( td->debug_level >= DEBUG_LEVEL_AS511 ) {
        fprintf(td->debug_handle,"Zeichen %02X anstatt %02X gelesen\n", *ch, test_ch );
      }
      td->errnr = CHAR_UNKNOWN;
      siglongjmp(td->env, CHAR_UNKNOWN );
    }
  }
  else {
    if( rc == 0 ) {
      if( td->debug_level >= DEBUG_LEVEL_AS511 ) {
        fprintf(td->debug_handle,"SPS Timeout: lese_byte_v2 %04X\n", SPS_TIMEOUT );
      }
      td->errnr = SPS_TIMEOUT;
      siglongjmp(td->env, SPS_TIMEOUT );
    }
    else {
      if( td->debug_level >= DEBUG_LEVEL_SYSTEM ) {
        fprintf(td->debug_handle,"Fehler in poll in funktion lese_byte_v2\n");
      }
      siglongjmp(td->env, rc);
    }
  }
  return rc;
}

/*
  schreibe_byte_v2

  Schreibt ein Zeichen zu dem Dateihandle td->fd

  Eingabe:
    td:       Zeiger auf eine mit open_tty erzeugte Datenstruktur
    ch:       Das zu schreibende Zeichen
  Ausgabe:    Rueckgabewert von poll() wenn die Funktion fehlerfrei
              ausgeführt wurde

  Fehlerbehandlung:
    Die Funktion kehrt nicht zum Aufrufer zurück, wenn ein Fehler auftritt.
    Die Funktionen schreibe_byte_v2 und lese_byte_v2 springen zu dem Punkt,
    der mit sigsetjmp definiert wurde.

    poll wartet maximal td->timeout Millisekunden. Dann wird SPS_TIMEOUT
    gesetzt und wie oben beschrieben an den Punkt, der mit sigsetjmp
    definiert wurde, gesprungen.
*/
int schreibe_byte_v2( td_t *td, unsigned char ch )
{
  int rc;
  struct pollfd pfd;

  pfd.fd = td->fd;
  pfd.events = POLLOUT;

  errno = 0; // Errno zurücksetzen

  if( (rc = poll(&pfd, 1, td->timeout)) > 0 ) {
    write(td->fd,&ch,1);
    if( td->debug_level >= DEBUG_LEVEL_AS511_ALL ) {
      DEBUG("PG -> AG %02X\n", ch );
    }
  }
  else {
    if( rc == 0 ) {
      if( td->debug_level >= DEBUG_LEVEL_AS511 ) {
        fprintf(td->debug_handle,"SPS Timeout: schreibe_byte_v2\n");
      }
      td->errnr = SPS_TIMEOUT;
      siglongjmp(td->env, SPS_TIMEOUT);
    }
    else {
      if( td->debug_level >= DEBUG_LEVEL_SYSTEM ) {
        fprintf(td->debug_handle,"Fehler in poll in funktion schreibe_byte_v2\n");
      }
      siglongjmp(td->env, rc);
    }
  }
  return rc;
}

/*
  schreibe_daten_v2

  Schreibt ein Zeichen zu dem Dateihandle td->fd. DLE ist ein Steuerzeichen im
  AS511 Protokoll. DLE wird doppelt geschrieben, damit die SPS DLE als Datenbyte
  erkennt.

  Eingabe:
    td:       Zeiger auf eine mit open_tty erzeugte Datenstruktur
    ch:       Das zu schreibende Zeichen
  Ausgabe:    Rueckgabewert von poll() wenn die Funktion fehlerfrei
              ausgeführt wurde

  Fehlerbehandlung:
    Die Funktion kehrt nicht zum Aufrufer zurück, wenn ein Fehler auftritt.
    Die Funktionen schreibe_byte_v2 und lese_byte_v2 springen zu dem Punkt,
    der mit sigsetjmp definiert wurde.

*/
int schreibe_daten_v2( td_t *td, unsigned char ch )
{
  int rc;

  rc = schreibe_byte_v2( td, ch );
  if( rc == 1 && ch == 0x10 ) // DLE als daten doppelt schreiben
    rc = schreibe_byte_v2( td, ch );

  return rc;
}

/* ------------------------------------------------------
   öffnet ein Terminal und stellt die Parameter so ein,
   daß eine komunikation mit der SPS möglich wird;

    sGeschwindigkeit    9600 baud
    datenbits           8 bit
    stopbits            2 bit
    parity              EVEN

  ---------------------------------------------------- */
td_t *open_tty( char *name )
{
  td_t  *td = Malloc(sizeof(td_t));

  td->timeout = TIMEOUT;

  if( (td->fd = open(name,O_RDWR|O_NONBLOCK)) > 0 ) // öffnen ohne Blockieren
  {
    fcntl(td->fd ,F_SETFL,fcntl(td->fd,F_GETFL,0) & ~O_NONBLOCK); // Blockieren
                                                                  // einschalten
    if( isatty(td->fd) ) // Prüfen, ob handle ein Terminal ist
    {
      if( tcgetattr(td->fd, &td->term2 ) == 0 ) // Schnittstellenattribute lesen
      {

        td->debug_level = 0;
        td->debug_handle = stderr;

        td->mem      = Malloc(MEM_SIZE);
        td->mem_size = MEM_SIZE;

        memcpy(&td->term1, &td->term2, sizeof(struct termios));

        cfsetispeed(&td->term1,B9600);
        cfsetospeed(&td->term1,B9600); // Baudrate Setzen

        /* Signale AUS (ISIG),
           ECHO AUS (ECHO),
           Sonderzeichen AUS (ICANON),
        */
        td->term1.c_lflag &= ~(ISIG | ECHO | ICANON | IEXTEN);

        td->term1.c_iflag &=
            ~(BRKINT | IGNBRK | IGNCR  | ICRNL  | INPCK  | ISTRIP |
              PARMRK | IXON );

        td->term1.c_cflag &= ~(CSIZE|PARODD);      // Parität EVEN
        td->term1.c_cflag |=  (CS8|PARENB|CSTOPB); // 8 Datenbits, Paritaet Ein,
                                                   // 2 Stoppbits
        td->term1.c_oflag &= ~(OPOST|ONLCR);       // Sonderzeichen AUS
                                                   // CR-NL nicht in NL Wandeln
        td->term1.c_cc[VMIN]  = 1;  /* Mindestens 1 zeichen Liefern */
        td->term1.c_cc[VTIME] = 0;  /* Warten, bis ein zeichen eingegeben wurde*/
        td->term1.c_cc[VEOF]  = 0;

        /* Terminalparameter setzen */
        if( tcsetattr(td->fd, TCSAFLUSH, &td->term1) == 0 );
          return td;
      }
    }
  }


  // Aufräumen wenn ein Fehler aufgetreten ist
  tcsetattr(td->fd,TCSAFLUSH,&td->term2);
  if( td->fd > 0 )
    close( td->fd );
  Free(td);

  return NULL;
}

int close_tty( td_t * td )
{
  tcsetattr(td->fd,TCSAFLUSH,&td->term2); // Terminalattribute restaurieren
  close(td->fd);                // Terminal schliessen
  Free( td->mem );
  Free( td );
  return 1;
}

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    Funktion protokoll_start

    Eingabe: td     Zeiger auf Datenstruktur mit allen notwendigen parametern
             bef    S5 Befehl Definiert in s5lib.h

    Ausgabe: 1 wenn die Funktion fehlerfrei ausgeführt wurde

    Fehlerbehandlung:
    Die Funktion kehrt nicht zum Aufrufer zurück, wenn ein Fehler auftritt.
    Die Funktionen schreibe_byte_v2 und lese_byte_v2 springen zu dem Punkt,
    der mit sigsetjmp definiert wurde.

    Beschreibung:
    Die Protokollfolge ist für alle S5 Befehle geleich.
    Danach unterscheiden sich der Ablauf im Protokollablauf
*/
int protokoll_start( td_t *td, unsigned char bef )
{
  unsigned char ch;
  int rc;

  schreibe_byte_v2(td, STX);
  lese_byte_v2(td, &ch, DLE, 1);
  lese_byte_v2(td, &ch, ACK, 1);
  schreibe_daten_v2(td, bef);      // Befehlsnummer
  lese_byte_v2(td, &ch, STX, 1);
  schreibe_byte_v2(td, DLE);
  schreibe_byte_v2(td, ACK);
  lese_byte_v2(td, &ch, 0, 0);
  rc = (int) ch;
  if( ch == CR ) {
    lese_byte_v2(td, &ch, STX, 1);
  }
  lese_byte_v2(td, &ch, DLE, 1);
  lese_byte_v2(td, &ch, ETX, 1);
  schreibe_byte_v2(td, DLE);
  schreibe_byte_v2(td, ACK);
  return rc;
}

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    Funktion protokoll_stop

    Eingabe: td   Zeiger auf Datenstruktur

    Ausgabe: Rueckgabewert der CPU (rc)



    Fehlerbehandlung:
    Die Funktion kehrt nicht zum Aufrufer zurück, wenn ein Fehler auftritt.
    Die Funktionen schreibe_byte_v2 und lese_byte_v2 springen zu dem Punkt,
    der mit sigsetjmp definiert wurde.

    Die Protokollfolge ist für alle S5 Befehle geleich.
    Davor unterscheiden sich der Ablauf im Protokollablauf

    Fehlermeldungen werden auf der Standart Fehlerausgabe protokolliert
*/
int protokoll_stopp( td_t *td )
{
  unsigned char ch;
  int rc = 0;

  lese_byte_v2(td, &ch, STX, 1);
  schreibe_byte_v2(td,DLE);
  schreibe_byte_v2(td,ACK);
  lese_byte_v2(td, &ch, 0, 0);

  rc = (int) ch;
  switch( rc ) {
    // Wenn DLE ein Datenbyte ist, DLE Doppelt Lesen
    // Ansonsten gehört DLE zum Protokoll und wird
    // nicht weiter verarbeitet
    case DLE: // 0x10
      lese_byte_v2(td, &ch, 0, 0);
      if( ch == ETX ) {
        schreibe_byte_v2(td,DLE);
        schreibe_byte_v2(td,ACK);
        return rc;
      }
      break;

    case DC1: // 0x11
      break;

    case DC2: // 0x12
      break;

    case DC4: // 0x14
      break;

    default:
      if( td->debug_level > DEBUG_LEVEL_AS511 ) {
        fprintf(td->debug_handle,
                "In Funktion protokoll_stopp:\n" \
                "Unerwartetes Zeichen %02X vom AG\n", ch );
      }
      siglongjmp(td->env, CHAR_UNKNOWN );
      break;
  }

  lese_byte_v2(td, &ch, DLE, 1);
  lese_byte_v2(td, &ch, 0, 0);
  schreibe_byte_v2(td,DLE);
  schreibe_byte_v2(td,ACK);

  return rc;
}

// Speicher fuer Bausteine freigeben, die mit
// as511_read_module oder as511_write_module erzeugt wurde und
// nicht mehr benoetigt werden
void  as511_module_mem_free( td_t *td, bs_t *bst )
{
  if( td && bst ) {
    if( bst->ptr ) {
      Free(bst->ptr);
    }
    Free( bst );
  }
}

// Baustein mit Daten füllen
// Die Bausteinlänge des SPS Codes OHNE der Länge des Bausteinkopfes
// wird in bytes übergeben.
int as511_set_bst_data( bs_t *bst, byte_t btyp, byte_t bnr, word_t code_size, byte_t *code )
{
  bst->laenge = code_size + sizeof(bs_kopf_t); // Bausteinlänge in Byte
  bst->kopf.baustein_sync1 = 0x70;
  bst->kopf.baustein_sync2 = 0x70;
  bst->kopf.baustein_nummer = bnr; // Bausteinnummer 0/1 .. 255
  bst->kopf.baustein_typ.btyp = btyp; // Bausteintyp OB, DB, SB ...
  bst->kopf.baustein_typ.bok = (unsigned)0;
  bst->kopf.pg_kennung = 0x80;
  bst->kopf.bib_nummer1 = 0;
  bst->kopf.bib_nummer2 = 0;
  bst->kopf.bib_nummer3 = 0;
  // Im Bausteinkopf wird die Länge in Worten angegeben
  bst->kopf.laenge = (unsigned short)((code_size + sizeof(bs_kopf_t)) / sizeof(word_t));
  bst->ptr = code;
  return 1;
}


// Datenstrom aus der SPS Lesen
int as511_read_data( td_t *td )
{
  int index = 0;
  unsigned char ch = 0;
  int DLEret = 0;

  while( 1 ) {
    lese_byte_v2(td,&ch,0,0 );
        // War das zuletzt gelesene Zeichen DLE und
        // ist das aktuelle Zeichen ETX wird hier die
        // Schleife beendet.
    if( ch == ETX && DLEret )
      break;

        // Merken, ob DLE Zurückgegeben wurde
        // Wenn nur 1 DLE vorhanden ist, erstmal
        // ohne speichern weitermachen.
    if( (DLEret = (ch == DLE && !DLEret )) )
      continue;

        // Alles andere wird hier gespeichert.
    td->mem[index++] = ch;
  }
  return index;
}

// Kopiere die Daten von td->mem[...] in die Struktur "smd"
int copy_module_data( td_t *td, int index,  smd_u *smd )
{
  if( td && smd ) {
    switch( smd->t.type ) {
      case DEBUG_MODULE_PAE:
      case DEBUG_MODULE_PAA:
      case DEBUG_MODULE_MERKER:
      case DEBUG_MODULE_NOPAR:
        memcpy(&DEBUG_MODULE_AG_ADDR(smd), &td->mem[index], 4 );
        index += 4;
        break;
      case DEBUG_MODULE_ZAEHLER:
      case DEBUG_MODULE_DATEN:
        memcpy(&DEBUG_MODULE_AG_ADDR(smd), &td->mem[index], 6 );
        index += 6;
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&DEBUG_MODULE_WORD_VALUE(smd),&DEBUG_MODULE_WORD_VALUE(smd),sizeof(short));
#endif
        break;
      case DEBUG_MODULE_LOAD:
        memcpy(&DEBUG_MODULE_AG_ADDR(smd), &td->mem[index], 8 );
        index += 8;
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&DEBUG_MODULE_AKKU1(smd),&DEBUG_MODULE_AKKU1(smd),sizeof(short));
        swab(&DEBUG_MODULE_AKKU2(smd),&DEBUG_MODULE_AKKU2(smd),sizeof(short));
#endif
        break;
      case DEBUG_MODULE_LOAD_LARGE:
        memcpy(&DEBUG_MODULE_AG_ADDR(smd), &td->mem[index], 12 );
        index += 12;
#if __BYTE_ORDER == __LITTLE_ENDIAN
        swab(&DEBUG_MODULE_AKKU1L(smd),&DEBUG_MODULE_AKKU1L(smd),sizeof(int));
        swab(&DEBUG_MODULE_AKKU2L(smd),&DEBUG_MODULE_AKKU2L(smd),sizeof(int));
#endif
        break;
    }
#if __BYTE_ORDER == __LITTLE_ENDIAN
    swab(&DEBUG_MODULE_AG_ADDR(smd),&DEBUG_MODULE_AG_ADDR(smd),sizeof(short));
#endif
  }
  // Anzahl der Kopierten Daten
  return index;
}
