/*
  Copyright (c) 1999-2009 Peter Schnabel

  Datei:   s5lib.h
  Datum:   03.09.2006
  Version: $Revision: 1.9 $

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

#ifndef _S5LIB_H_
#define _S5LIB_H_

// Diese Datenstruktur ist für alle as511 Bausteinaufrufe zwingend
// Die Struktur wird mit der Funktion open_tty inititalisiert und
// mit close_tty geschlossen.
//
// Je Schnittstelle in /dev/ttyS? kann diese Struktur angelegt werden
struct thread_daten
{
  int            fd;      // handle fuer terminal /dev/ttyS*
  int            timeout; // Überwachungszeit für Lesen und Schreiben
  int            errnr;   // Fehlernummer der Funktionen as511_*
  sigjmp_buf     env;     // Sprungmarke für dieses Handle
  unsigned char *mem;     // Zwischenspeicher für Funktionen
  size_t         mem_size;// Länge des Speicherbereiches in "mem"
  struct termios term1;   // Neue Terminaleinstellungen
  struct termios term2;   // Alte Terminaleinstellungen
  struct dbl_list_head *dlh; // Kopf einer doppelt verketteten liste
  int            debug_level; // 0 ...
  FILE          *debug_handle;// Handle zur Ausgabe von Fehlermeldungen
};
typedef struct thread_daten td_t;

#include <as511_mem.h>
#include <as511.h>
#include <as511_ustack.h>

#define TTY_S1_BAUD 9600;
#define TTY_S2_BAUD 9600;
#define TTY_S3_BAUD 9600;
#define TTY_S4_BAUD 9600;

// AG Typ
#define AG090U    0x0001
#define AG095U    0x0002
#define AG100U    0x0003
#define AG101U    0x0004
#define AG110S    0x0005
#define AG115U    0x0006
#define AG130W    0x0007
#define AG135U    0x0008
#define AG150A    0x0009
#define AG150S    0x000A
#define AG155U    0x000B

// CPU Kennung
#define CPU090    0x0010
#define CPU095    0x0011
#define CPU100    0x0021
#define CPU101    0x0022
#define CPU102    0x0023
#define CPU103    0x0024
#define CPU941    0x0041
#define CPU942    0x0042
#define CPU943    0x0043
#define CPU944    0x0044
#define CPU945    0x0045
#define CPU921    0x0051
#define CPU922    0x0052
#define CPU928    0x0061
#define CPU928B   0x0062
#define CPU948    0x0071
#define CPU948R   0x0072

// ASCII Steuerzeichen zur Kommunikation mit der SPS
#define NUL 0x00     /* Füllzeichen */
#define SOH 0x01     /* Start of haeder */
#define STX 0x02     /* Start of text */
#define ETX 0x03     /* End of text */
#define EOT 0x04     /* End of Transmision */
#define ENQ 0x05     /* Enquiry */
#define ACK 0x06     /* Acknowledge */
#define BEL 0x07     /* .... */
#define BS  0x08
#define HT  0x09
#define LF  0x0A
#define VT  0x0B
#define FF  0x0C
#define CR  0x0D
#define SO  0x0E
#define SI  0x0F
#define DLE 0x10
#define DC1 0x11
#define DC2 0x12
#define DC3 0x13
#define DC4 0x14
#define NAK 0x15
#define SYN 0x16
#define ETB 0x17
#define CAN 0x18
#define EM  0x19
#define SUB 0x1A
#define ESC 0x1B
#define FS  0x1C
#define GS  0x1C
#define RS  0x1D
#define US  0x1E

#define UCHAR(x)  ((unsigned char)(x))
#define USHORT(x) ((unsigned short)(x))
#if __BYTE_ORDER == __LITTLE_ENDIAN
#define HI(x)  ((unsigned char)(((x) & 0xFF00) >> 8))
#define LO(x)  ((unsigned char) ((x) & 0x00FF))
#define LHI(x) (((x) & 0xFFFF0000L) >> 16)
#define LLO(x) ( (x) & 0x0000FFFFL)
#else
#define LO(x)  (((x) & 0xFF00) >> 8)
#define HI(x)  ( (x) & 0x00FF)
#define LLO(x) (((x) & 0xFFFF0000L) >> 16)
#define LHI(x) ( (x) & 0x0000FFFFL)
#endif

// 1000ms = 1s
#define TIMEOUT 1000

// Fehlercode
#define NO_ERROR           0x0000

#define CHAR_UNKNOWN       0x8001
#define SPS_TIMEOUT        0x8002
#define POLL_ERROR         0x8004
#define UNKNOWN_MODULE     0x8008

#define CTRL_OUTP_BADLST   0x2001

#define STATUS_NO_DATA     0x4001
#define MODULE_NOT_PRESENT 0x4002
#define ERROR_AG_RUNING    0x4004
#define STACK_EMPTY        0x4008

#define BAD_PARAMETER      0x1001


// Status Var
#define STATUS_VAR_TIMER_WERT(s)      ((s)->t6.w.t.wert)
#define STATUS_VAR_TIMER_BASIS(s)     ((s)->t6.w.t.basis)
#define STATUS_VAR_TIMER_RUN(s)       ((s)->t6.w.t.run)

// Status Module
#define STATUS_MODULE_AG_ADDR(s)      ((s)->t.ag_addr)
#define STATUS_MODULE_VKE(s)          ((s)->t.vke)

#define STATUS_MODULE_BYTE_VALUE(s)   ((s)->t4.val)

#define STATUS_MODULE_TIMER_WERT(s)   ((s)->t6.w.t.wert)
#define STATUS_MODULE_TIMER_BASIS(s)  ((s)->t6.w.t.basis)
#define STATUS_MODULE_TIMER_RUN(s)    ((s)->t6.w.t.run)
#define STATUS_MODULE_ZAEHLER_WERT(s) ((s)->t6.w.z.wert)
#define STATUS_MODULE_WORD_VALUE(s)   ((s)->t6.w.d.wert)

#define STATUS_MODULE_S2(s)           ((s)->t8.status_2)
#define STATUS_MODULE_AKKU1(s)        ((s)->t8.akku1)
#define STATUS_MODULE_AKKU2(s)        ((s)->t8.akku2)

#define STATUS_MODULE_AKKU1L(s)       ((s)->t12.akku1)
#define STATUS_MODULE_AKKU2L(s)       ((s)->t12.akku2)

// DEBUG Module
#define DEBUG_MODULE_AG_ADDR(s)      ((s)->t.ag_addr)
#define DEBUG_MODULE_VKE(s)          ((s)->t.vke)

#define DEBUG_MODULE_BYTE_VALUE(s)   ((s)->t4.val)

#define DEBUG_MODULE_TIMER_WERT(s)   ((s)->t6.w.t.wert)
#define DEBUG_MODULE_TIMER_BASIS(s)  ((s)->t6.w.t.basis)
#define DEBUG_MODULE_TIMER_RUN(s)    ((s)->t6.w.t.run)
#define DEBUG_MODULE_ZAEHLER_WERT(s) ((s)->t6.w.z.wert)
#define DEBUG_MODULE_WORD_VALUE(s)   ((s)->t6.w.d.wert)

#define DEBUG_MODULE_S2(s)           ((s)->t8.status_2)
#define DEBUG_MODULE_AKKU1(s)        ((s)->t8.akku1)
#define DEBUG_MODULE_AKKU2(s)        ((s)->t8.akku2)

#define DEBUG_MODULE_AKKU1L(s)       ((s)->t12.akku1)
#define DEBUG_MODULE_AKKU2L(s)       ((s)->t12.akku2)

// Die CPU Kennung 2 wird nur in verbindung mit der CPU Kennung 1
// verwendet
// CPU Kennung 2 LO
#define CPU_KENNUNG2_AG100U   0x01
#define CPU_KENNUNG2_AG101U   0x02
#define CPU_KENNUNG2_AG105U   0x03
#define CPU_KENNUNG2_AG115U   0x04
#define CPU_KENNUNG2_AG150U   0x06
#define CPU_KENNUNG2_AG135U   0x07
#define CPU_KENNUNG2_AG155U   0x08
// CPU Kennung 2 HI
#define CPU_KENNUNG2_CPU928B  0xB0
#define CPU_KENNUNG2_CPU948R  0x30

// Größe des Zwischenpuffers in Byte für open_tty
#define MEM_SIZE  65536

#define DEBUG_LEVEL_NONE      0
#define DEBUG_LEVEL_SYSTEM    5
#define DEBUG_LEVEL_AS511     10
#define DEBUG_LEVEL_AS511_ALL 20
#define DEBUG_LEVEL_ALL       30

#define SYNC1(bst) ((bst)->kopf.baustein_sync1)
#define SYNC2(bst) ((bst)->kopf.baustein_sync2)
#define BSTNR(bst) ((bst)->kopf.baustein_nummer)
#define BSTTYP(bst)((bst)->kopf.baustein_typ.btyp)

typedef unsigned char  byte_t;
typedef unsigned short word_t;
typedef unsigned int   dword_t;
typedef unsigned int   bool_t;

// **********************************************************************
// Implementireungs abhängige Datenstrukturen.
// **********************************************************************

// Baustein incl. Bausteinkopf
struct sps_bst
{
  unsigned long laenge; // Laenge des Datenbereiches auf das ptr zeigt
                        // + Bausteinkopf in Bytes
  unsigned char *ptr;   // Zeiger auf Bausteindaten ohne kopf
  bs_kopf_t     kopf;   // Bausteinkopf
};
typedef struct sps_bst bs_t;

// Baustein Adress Liste
struct bst_list
{
  unsigned long laenge;
  unsigned short *ptr;
};
typedef struct bst_list bal_t;

// Abbild des Speicherbereiches in der SPS
struct sps_ram
{
  unsigned long laenge;
  unsigned char *ptr;
};
typedef struct sps_ram sps_ram_t;
typedef struct sps_ram ram_t;

// BSTACK
struct bstackformat
{
  unsigned short dbnr;
  unsigned short retaddr;
};
typedef struct bstackformat bstackfmt;

struct bstack
{
  unsigned long laenge; // Anzahl der Elemente bstackfmt
  bstackfmt    *ptr;    // liste bstackfmt
};
typedef struct bstack bstack_t;

struct ptr
{
  unsigned int typ;
  union {
    bs_t  bst;
    bal_t bal;
    ram_t ram;
  } m;
};
typedef struct ptr ptr_t;


// Daten allgemein
struct daten
{
  unsigned short wert;
} __attribute__((packed));

// STATUS VAR
union status_var_daten
{
  unsigned short type; // vom Type abhaengig,
                       // welche Datenstruktur verwendet wird

  struct status_var_type
  {
    unsigned short type;
    unsigned short addr;
  } t __attribute__((packed));

  struct type4
  {
    unsigned short type;    // Der Befehlscode Daten, Zeiten, Zähler ...
    unsigned short addr;    // Die Speicheradresse der Zeitzellen,
                            // Zählerzellen, Merker ...

    unsigned char status_0; // ab hier sind Daten gespeichert
    unsigned char status_1;
    unsigned char status_2;
    unsigned char w;        // Wert der Merker
  } t4 __attribute__((packed));

  struct type6
  {
    unsigned short type;     // Der Befehlscode Daten, Zeiten, Zähler ...
    unsigned short addr;     // Die Speicheradresse der Zeitzellen,
                             // Zählerzellen, Merker ...

    unsigned char status_0;  // ab hier sind Daten gespeichert
    unsigned char status_1;
    unsigned char status_2;
    unsigned char status_3;
    union wert
    {
      struct timer t;        // Zeitzellen
      struct zaehler z;      // Zähler
      struct daten d;        // Datenwörter
    } w;
  } t6 __attribute__((packed));
} __attribute__((packed));
typedef union status_var_daten svd_u;

// STATUS MODULE
union status_module_daten
{
  unsigned short type; // vom Type abhaengig,
                      // welche Datenstruktur verwendet wird

  struct status_module_type
  {
    unsigned short type;   // Der Befehlscode
    unsigned short addr;  // Die Speicheradresse

    unsigned short ag_addr;
    unsigned char  vke;
  } t __attribute__((packed));

  struct m_type4
  {
    unsigned short type;    // Der Befehlscode
    unsigned short addr;    // Die Speicheradresse

    unsigned short ag_addr; // ab hier sind Daten gespeichert
    unsigned char  vke;
    unsigned char  val;
  } t4 __attribute__((packed));

  struct m_type6
  {
    unsigned short type;    // Der Befehlscode
    unsigned short addr;    // Die Speicheradresse

    unsigned short ag_addr; // ab hier sind Daten gespeichert
    unsigned char  vke;
    unsigned char  status_2;
    union m_wert
    {
      struct timer t;
      struct zaehler z;
      struct daten d;
    } w;
  } t6 __attribute__((packed));

  struct m_type8
  {
    unsigned short type;    // Der Befehlscode
    unsigned short addr;    // Die Speicheradresse

    unsigned short ag_addr; // ab hier sind Daten gespeichert
    unsigned char  vke;
    unsigned char  status_2;
    unsigned short akku1;
    unsigned short akku2;
  } t8 __attribute__((packed));

  struct m_type12
  {
    unsigned short type;    // Der Befehlscode
    unsigned short addr;    // Die Speicheradresse

    unsigned short ag_addr; // ab hier sind Daten gespeichert
    unsigned char  vke;
    unsigned char  status_2;
    unsigned int   akku1;
    unsigned int   akku2;
  } t12 __attribute__((packed));
} __attribute__((packed));
typedef union status_module_daten smd_u;

// Speicheradressen Start Ram, Strat FREE Ram, End Ram
struct ram_info
{
  unsigned short start_ram;
  unsigned short begin_free_ram;
  unsigned short end_ram;
}__attribute__((packed));
typedef struct ram_info raminfo_t;

// AG Typ
struct s5ag
{
  word_t cpu_typ;
  word_t ag_typ;
  const  char *cpu;
};
typedef struct s5ag ag_t;

// Ausgaenge Steueren
struct ctrl_output
{
  byte_t addr;    // Adresse des Ausgangsbytes z.B AB64
  byte_t value;   // Wert, der zum Ausgang geschrieben werden soll
  void   *userdata; // Kann von Anwender beliebig verwendet werden.
};
typedef struct ctrl_output cop_t;

struct ctrl_output_badlst
{
  byte_t *badlst; // Wird nur verwendet, wenn eine Ausgabebaugruppe
                  // angesprochen wurde, die nicht addresiert werden kann
  int     badlstsize; // Länge der liste
};
typedef struct ctrl_output_badlst copbl_t;

#ifdef _S5LIB_C_
int protokoll_start( td_t *td, unsigned char bef );
int protokoll_stopp( td_t *td );
int schreibe_byte_v2( td_t *td, unsigned char ch );
int schreibe_daten_v2( td_t *td, unsigned char ch );
int lese_byte_v2( td_t *td,
                  unsigned char *ch,
                  unsigned char test_ch,
                  int test_enable );
int as511_read_data( td_t *td );
#endif

ag_t *as511_get_ag_typ( td_t *td, syspar_t *sp );

int as511_set_bst_data( bs_t *bst, byte_t btyp, byte_t bnr, word_t code_size, byte_t *code );

modinfo_t  *as511_read_module_info( td_t *td,
                                     unsigned char bst_typ,
                                     unsigned char bst_nr );
void  as511_read_module_info_free( td_t * td, modinfo_t * mi );

word_t     as511_get_bst_addr_size( td_t *td, syspar_t *sp, byte_t bsttyp );
syspar_t  *as511_read_system_parameter( td_t *td );
void as511_read_system_parameter_free( td_t *td, syspar_t *sp );

raminfo_t *as511_read_ram_info( td_t *td );

void  as511_read_ram_free( td_t *td, sps_ram_t *sr );

// Speicher Lesen
sps_ram_t  *as511_read_ram ( td_t *td,
                             unsigned short adr,
                             unsigned short laenge );
sps_ram_t * as511_read_ram32( td_t *td,
                              unsigned long adr,
                              unsigned long laenge );

// Speicher Schreiben
int as511_write_ram    ( td_t *td,
                         unsigned short adr,
                         unsigned short laenge,
                         unsigned char *ptr );
int as511_write_ram32  ( td_t *td,
                         unsigned long adr,
                         unsigned long laenge,
                         unsigned char *ptr );

void   as511_module_mem_free( td_t *td, bs_t *bst );

// Baustein Lesen
bs_t *as511_read_module( td_t *td,
                         unsigned char btyp,
                         unsigned char bnr );
void  as511_read_module_free( td_t * td, bs_t *bst );

// Baustein Adressliste lesen
bal_t  *as511_read_module_addr_list( td_t *td, unsigned char bst_typ );
void  as511_read_module_addr_list_free( td_t *td, bal_t *bal );

// Baustein Scheriben
int as511_write_module( td_t *td, bs_t *bst );

// Baustein löschen
int as511_delete_module( td_t *td,
                         unsigned char bst_typ,
                         unsigned char bst_nr );

// Alle Bausteine Löschen (AG Urlöschen)
int as511_delete_module_all( td_t *td );

// AG Neustart,Wiederanlauf, Stop (Nicht 100U, 95U)
int as511_change_operating_mode( td_t *td, unsigned char mode );

// Funktionen fuer STATUS VAR
int as511_status_var_create( td_t *td );
int as511_status_var_destroy( td_t *td, int (*usrfk)(void*) );
dl_t *as511_status_var_insert_type( td_t *td, unsigned char type, unsigned short addr, int (*usrfk)(void*), void *udata );
void as511_status_var_free( td_t *td, int (*usrfk)(void*) );
int as511_status_var_start( td_t *td );
int as511_status_var_run( td_t *td );
int as511_status_var_stop( td_t *td );

// Funktionen fuer STATUS MODULE (Baustein)
int   as511_status_module_destroy( td_t *td, int (*usrfk)(void*) );
int   as511_status_module_create ( td_t *td );
int as511_status_module_run( td_t *td );
int as511_status_module_start( td_t *td, unsigned short offset,
                               unsigned char bst_typ, unsigned char bst_nr );
int as511_status_module_insert_op( td_t *td, unsigned short type, unsigned short addr, void *udata );


// Kopiere die Daten von td->mem[...] in die Struktur "smd"
int copy_module_data( td_t *td, int index, smd_u *smd );
// Beenden der Funktion Status Module
int    as511_status_module_stop( td_t *td );  // Beenden der Funktion Status Module

// Ausgänge Steuern
int as511_ctrl_output_init( td_t *td );
copbl_t *as511_ctrl_output_start( td_t *td );
int as511_ctrl_output_stop( td_t *td );
int as511_ctrl_output_insert_op( td_t *td, byte_t addr, byte_t value, void *udata );
int as511_ctrl_output_destroy( td_t *td, int (*usrfk)(void*) );
int as511_ctrl_output_create( td_t *td );
void as511_ctrl_output_bl_free( td_t *td, copbl_t *bl );

// AG STOP (nur 95U, 100U)
int as511_ag_stop ( td_t *td );

//AG RUN (nur 95U, 100U)
int as511_ag_run ( td_t *td );

// AG Speicher Komprimieren
int as511_compress_ram( td_t *td );

// BSTACK Lesen
bstack_t *as511_read_bstack( td_t * td );
void  as511_read_bstack_free( td_t * td, bstack_t *b );

int close_tty ( td_t * td );
td_t *open_tty ( char *name );

// STEP MODULE (Bearbeitungskontrolle)
int    as511_step_module_destroy  ( td_t *td, int (*usrfk)(void*) );
int    as511_step_module_create   ( td_t *td );
int    as511_step_module_insert_op( td_t *td, unsigned short type, unsigned short addr, void *udata );
int    as511_step_module_init     ( td_t *td );
dl_t  *as511_step_module_start    ( td_t *td, unsigned short offset, unsigned char bst_typ, unsigned char bst_nr );
dl_t  *as511_step_module_continue ( td_t *td, dl_t *dl );
int    as511_step_module_stop     ( td_t *td );

/* Speicher vom System Anfordern/Freigeben. Die Funktionen beenden Das Programm,
   wenn kein weiterer Speicher vorhanden ist.
   Funktionen in wrappers.c
*/
void  Free   ( void *p );
void *Malloc ( size_t size );

#endif // #ifdef _S5LIB_H_
