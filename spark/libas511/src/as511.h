/*
  Copyright (c) 1999-2009 Peter Schnabel

  Datei:   as511.h
  Datum:   20.07.2007
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
#ifndef _AS511_H_
#define _AS511_H_

// Baustein Typen
#define DB 0x01
#define SB 0x02
#define PB 0x04
#define FX 0x05
#define FB 0x08
#define DX 0x0C
#define OB 0x10
/* Testbaustein nur in Verbindung mit anderen Bausteintypen
   SB, PB, FX, FB, OB
*/
#define TB 0x20

// Run Stop Bits im Speicherbereich Systemdaten
// Nur für die "kleinen" CPU Typen 100U 115U
#define SD_STOZUS 0x80
#define SD_STOANZ 0x40
#define SD_NEUSTA 0x20
#define SD_AF     0x04

// AS511 Befehle
// #define UNBEK01               0x01
// #define UNBEK02               0x02
#define S5_WRITE_MEM             0x03
#define S5_READ_MEM              0x04
#define S5_WRITE_BST             0x05
#define S5_READ_BST              0x06
#define S5_KOMPR_RAM             0x07
#define S5_WRITE_DB              0x08
#define S5_DELETE_MODULE         0x09
// #define UNBEK0A               0x0A
// #define UNBEK0B               0x0B
// #define UNBEK0C               0x0C
// #define UNBEK0D               0x0D
#define S5_DEBUG_START           0x0E
// #define UNBEK0F               0x0F
#define S5_DEBUG_CONTINUE        0x10
#define S5_DELETE_MODULE_ALL     0x11
// #define UNBEK12               0x12
#define S5_CTRL_OUTPUT           0x13
#define S5_STATUS_VAR            0x14
#define S5_STATUS_BST            0x15
#define S5_DEBUG_INIT            0x16
#define S5_CTRL_OUTPUT_INIT      0x17
#define S5_READ_SYSPAR           0x18
#define S5_READ_RAM_INFO         0x19
#define S5_READ_BOOKMARKER       0x1A
#define S5_READ_BST_ADDR_LIST    0x1B
#define S5_READ_BSTACK           0x1C
#define S5_READ_USTACK           0x1D
#define S5_CH_OP_MODE            0x1E

#define S5_ONLINE_START          0x80
#define S5_ONLINE_STOP           0x81

/* Start/Stop Modi der CPU 135/155
   S5_CH_OP_MODE_STOP      Stop
   S5_CH_OP_MODE_RESTART   Neustart
   S5_CH_OP_MODE_REBOOT    Wiederanlauf
*/
#define S5_CH_OP_MODE_STOP       0x00
#define S5_CH_OP_MODE_RESTART    0x01
#define S5_CH_OP_MODE_REBOOT     0x02

// STATUS VAR (Status Variable) +++++++++++++++++++++++++
// Werte Byteweise aus PAR Lesen
#define STATUS_VAR_PAE           0x30

// Werte Byteweise aus PAA Lesen
#define STATUS_VAR_PAA           0x31

// Merke Byteweise Lesen (Auch Wörter und Doppelwörter)
#define STATUS_VAR_MERKER        0x32

// Zählwerte Lesen (Wortweise)
#define STATUS_VAR_ZAEHLER       0x33

// Zeiten/Datenwörter Lesen (Wortweise)
#define STATUS_VAR_DATEN         0x34


// STATUS MODULE (Status Baustein) ++++++++++++++++++++++
// Werte Byteweise aus PAE Lesen
#define STATUS_MODULE_PAE        0x30

// Werte Byteweise aus PAA Lesen
#define STATUS_MODULE_PAA        0x31

// Merke Byteweise Lesen (Auch Wörter und Doppelwörter)
#define STATUS_MODULE_MERKER     0x32

// Zählwerte Lesen (Wortweise)
#define STATUS_MODULE_ZAEHLER    0x33

// Zeiten/Datenwörter Lesen (Wortweise)
#define STATUS_MODULE_DATEN      0x34

// Operatoren ohne Parameter z.B O, U(,  ) (Nur Status)
#define STATUS_MODULE_NOPAR      0x35

// Oberatoren wie L KT ...
// Für CPUS mit 32 bit breiten Akkus Large Verwenden
#define STATUS_MODULE_LOAD       0x0036
#define STATUS_MODULE_LOAD_LARGE 0x0136


// DEBUG MODULE (Bearbeitungskontrolle) +++++++++++++++++
// Werte Byteweise aus PAR Lesen
#define DEBUG_MODULE_PAE        0x30

// Werte Byteweise aus PAA Lesen
#define DEBUG_MODULE_PAA        0x31

// Merke Byteweise Lesen (Auch Wörter und Doppelwörter)
#define DEBUG_MODULE_MERKER     0x32

// Zählwerte Lesen (Wortweise)
#define DEBUG_MODULE_ZAEHLER    0x33

// Zeiten/Datenwörter Lesen (Wortweise)
#define DEBUG_MODULE_DATEN      0x34

// Operatoren ohne Parameter z.B O, U(,  ) (Nur Status)
#define DEBUG_MODULE_NOPAR      0x35

// Oberatoren wie L KT ...
// Für CPUS mit 32 bit breiten Akkus Large Verwenden
#define DEBUG_MODULE_LOAD       0x0036
#define DEBUG_MODULE_LOAD_LARGE 0x0136

// **********************************************************************
// SPS Spezifische Datenstrukturen
// **********************************************************************

// Struktur des Bausteinkopfes;
struct baustein_kopf
{
  unsigned char  baustein_sync1;      // Anfangskennung (0x70)
  unsigned char  baustein_sync2;      // Anfangskennung (0x70)
  struct
  {
    unsigned int  btyp :6;            // Bausteintyp
    unsigned int  bok  :2;            // Baustein ist gültig
  } __attribute__((packed)) baustein_typ;
  unsigned char  baustein_nummer;     // Bausteinnummer
  unsigned char  pg_kennung;          // PG Kennung
  unsigned char  bib_nummer1;         // Bib Nummer
  unsigned char  bib_nummer2;         // Bib Nummer
  unsigned char  bib_nummer3;         // Bib Nummer
  unsigned short laenge;              // Bausteinlänge + Bausteinkopf
                                      // in Worten
}__attribute__((packed));

typedef struct baustein_kopf bs_kopf_t;

// ----------------------------------------------------------
//   Buchhalterformat wie es von der SPS gelesen wird.
//   Das erste Byte, das von der SPS Gelesen wird ist 0x00.
//   Dieses byte wird nicht in der Struktur "buchhalter"
//   gespeichert.
// ----------------------------------------------------------
struct buchhalter
{
  unsigned short ram_adresse;         // Adresse im S5 Ram des Bausteins
  // Ab hier beginnt der Bausteinkopf
  unsigned char  baustein_sync1;      // Anfangskennung (0x70)
  unsigned char  baustein_sync2;      // Anfangskennung (0x70)
  struct
  {
    unsigned int  btyp :6;            // Bausteintyp
    unsigned int  bok  :2;            // Baustein ist gültig
  }__attribute__((packed)) bst;
  unsigned char  baustein_nummer;     // Bausteinnummer
  unsigned char  pg_kennung;          // PG Kennung
  unsigned char  bib_nummer1;         // Bib Nummer
  unsigned char  bib_nummer2;         // Bib Nummer
  unsigned char  bib_nummer3;         // Bib Nummer
  unsigned short laenge;              // Bausteinlänge + Bausteinkopf
                                      // in Worten
}__attribute__((packed));             // Bausteinkopfgroesse 10 Bytes
typedef struct buchhalter buchhalter_t;
typedef struct buchhalter modinfo_t;

/*
 Systemparameter werden mit der Funktion S5_READ_SYSPAR 0x18
 aus dem AG gelesen
*/
struct sps_system_parameter
{
  unsigned short AddrESF;           // +0  Adresse Eingangssignalformer
  unsigned short AddrASF;           // +2  Adresse Ausgangssignalformer
  unsigned short AddrPAE_Digital;   // +4  Adresse Prozessabbild Eingaenge
  unsigned short AddrPAA_Digital;   // +6                        Ausgaenge
  unsigned short AddrMerker;        // +8  Speicher für Merker
  unsigned short AddrZeiten;        // +10 Speicher für zeiten
  unsigned short AddrZaehler;       // +12 Speicher für Zähler
  unsigned short AddrSystemDaten;   // +14 Systemdatem
  unsigned char  AG_sw_version;     // +16 AG Softwareversion
  unsigned char  StatusKennung;     // +17 Status Kennung
  unsigned short AddrEndRam;        // +18 Ende des Ramspeichers
  unsigned short SystemProgRam;     // +20 ???? CPU 103 Wert = 0
  unsigned short Laenge_DB_liste;   // +22 Laenge Baustein Adress Liste DB
  unsigned short Laenge_SB_Liste;   // +24 Laenge Baustein Adress Liste SB
  unsigned short Laenge_PB_Liste;   // +26 Laenge Baustein Adress Liste PB
  unsigned short Laenge_FB_Liste;   // +28 Laenge Baustein Adress Liste FB
  unsigned short Laenge_OB_Liste;   // +30 Laenge Baustein Adress Liste OB
  unsigned short Laenge_FX_Liste;   // +32 Laenge Baustein Adress Liste TB/FX
  unsigned short Laenge_DX_Liste;   // +34 Laenge Baustein Adress Liste DX
  unsigned short Laenge_DB0_Liste;  // +36 Laenge DB0 Liste
  unsigned char  CPU_Kennung2;      // +38 CPU Kennung 2
  unsigned char  Steckplatzkenng;   // +39 Steckplatzkennung oder
                                    //     Geraete Eingabepuffer -1
  unsigned short BstKopfLaenge;     // +40 Länge Bausteinkopf
  unsigned char  unbek_7;           // +42 ???? CPU 103 Wert = 0
  unsigned char  CPU_Kennung;       // +43 CPU Kennung
  unsigned short unbek_8;           // +44 ???? CPU 103 Wert = 0
  unsigned short unbek_9;           // +46 ???? CPU 103 Wert = 0
  unsigned short unbek_10;          // +48 ???? CPU 103 Wert = 0
} __attribute__((packed));
typedef struct sps_system_parameter sp_t;


struct syspar
{
  unsigned long laenge;
  sp_t          sp;
}__attribute__((packed));
typedef struct syspar syspar_t;


union sd  // Template fuer Systemdatenwort 0-254
{
  unsigned short word;    // Wortweise Adressierung z.B. SD33

  struct                  // Byteweise Adressierung z.B. Korrekturwert
  {
    unsigned char byte0;
    unsigned char byte1;
  } byte;

  struct                  // Bitweise Adressierung
  {
    unsigned int u0:1;
    unsigned int u1:1;
    unsigned int u2:1;
    unsigned int u3:1;
    unsigned int u4:1;
    unsigned int u5:1;
    unsigned int u6:1;
    unsigned int u7:1;

    unsigned int u8:1;
    unsigned int u9:1;
    unsigned int u10:1;
    unsigned int u11:1;
    unsigned int u12:1;
    unsigned int u13:1;
    unsigned int u14:1;
    unsigned int u15:1;
  } bit __attribute__((packed));
} __attribute__((packed));

// Zeiten
struct timer
{
  unsigned int wert:10; // Zeitwert Dual
  unsigned int fr:1;    // Freigabebit
  unsigned int fl:1;    // Flanke fuer Start
  unsigned int basis:2; // Zeitbasis 0=0.01s, 1=0.1s, 2=1s, 3=10s
  unsigned int unb0:1;  // wird beim Starten irgenwie benutzt ?
  unsigned int run:1;   // Zeit Laeuft
}__attribute__((packed));

// Zaehler
struct zaehler
{
  unsigned int wert:10; // Zaehlwert Dual
  unsigned int fr:1;    // Freigabebit
  unsigned int set:1;   // Setzen des Zaehlers
  unsigned int zr:1;    // Zaehle rueckwaerts
  unsigned int zv:1;    // Zaehle Vorwaerts
  unsigned int unb1:1;  // bit 14 ist immer 0
  unsigned int run:1;   // Zaehlwert > 0
} __attribute__((packed));

#endif
