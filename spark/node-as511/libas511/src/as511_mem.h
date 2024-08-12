/*
  Copyright (c) 2009 Peter Schnabel

  Datei:   mem.h
  Datum:   19.07.2007
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

/* Speicherverwaltung NEU für z.B Status Var, Status Module, Augänge Steuern ...
   Der Umbau der Funktionen as511_* wird wohl längere Zeit in Anspruch nehmen.
   Funktionen in mem.c
*/

#ifndef __AS511_MEM_H__
#define __AS511_MEM_H__

#define DL_LOCK   1
#define DL_UNLOCK 0

#define MEM_NO_DATA  1
#define MEM_BAD_TYPE 2
#define MEM_NO_ERROR 0

// Datatype Parameter in den funktionen dl_insertv und dl_insertn
#define DL_TYPE_STATUS_VAR    1
#define DL_TYPE_STATUS_MODULE 2
#define DL_TYPE_CTRL_OUTPUT   4
#define DL_TYPE_STEP_MODULE   8

#define DL_GET_DATA(d_type, d ) ((d_type*) (d)->data )

struct MallocList
{
  struct MallocList *v;
  struct MallocList *n;
  int                ptr;
  size_t             size;
  int                isfree;
};
typedef struct MallocList ML;

struct MallocDebug
{
  int debug;
  ML *mlf; // first
  ML *mll; // last
};
typedef struct MallocDebug MD;

struct dbl_list_head
{
  struct dbl_list *f;  // Erster Knoten der Liste
  struct dbl_list *l;  // Letzter knoten der Liste

  int    dl_type;      // Typ der Daten, Status Var, Status Module ...
  int    dl_lock;      // Sperre für Einfügen und Löschen
  void   *data;        // Globale Listendaten, die nur einmal je Liste benötigt werden
};
typedef struct dbl_list_head dlf_t;  // aus Kompatibilitätsgründen noch vorhanden
typedef struct dbl_list_head dlh_t;

/* Speicherverwaltung NEU für z.B Status Var, Status Module, Augänge Steuern ...
   Der Umbau der Funktionen as511_* wird wohl längere Zeit in Anspruch nehmen.
   Funktionen in mem.c
*/
struct dbl_list
{
  struct dbl_list *v; // Vorgängerknoten
  struct dbl_list *n; // Nachfolgerknoten
  void  *data;         // Zeiger auf die Daten
  void  *udata;        // Benutzerdefinierte Daten
};
typedef struct dbl_list dl_t;

dl_t *dlh_insert_last ( dlh_t *dlh );
dl_t *dlh_insert_first( dlh_t *dlh );
int   dl_insert_data( dlh_t *dlh, dl_t *dl, int dl_type, void *data, size_t ds, void *udata );

dlh_t *dlh_create ( int dl_type );
void * dlh_delete ( dlh_t *dlh, dl_t *dl, int dl_type, int (*usrfk)(void*), void *ud);
dl_t  *dl_create  ( void );

int dl_print_data( dl_t *dl );

#endif
