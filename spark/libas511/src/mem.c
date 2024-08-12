/*
  Copyright (c) 2009 Peter Schnabel

  Datei:   mem.c
  Datum:   26.04.2007
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
#include <termios.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <stdio.h>
#define  _S5LIB_C_
#include <as511_s5lib.h>


// Neue liste erzeugen dlh
dlh_t *dlh_create ( int dl_type )
{
  dlh_t *dlh;
  dlh = Malloc(sizeof(dlh_t));
  dlh->f = NULL;
  dlh->l = NULL;

  dlh->dl_type = dl_type;
  return dlh;
}

// Neuen Knoten erzeugen (dl)
dl_t *dl_create ( void )
{
  dl_t *dl;
  dl = Malloc(sizeof(dl_t));
  return dl;
}

/*
  Funktion: dl_t *dlh_insert_last( dlh_t *dlh )

  Eingabeparameter: dlh
                    Kopf einer Doppelt Verkettete Liste mit Allgemeinen Daten.


  Ausgabeparameter: Zeiger auf den neuen Datensatz.

  Funktion:         erzeugt einen neuen knoten und fügt ihn am ende der Liste ein.
                    Ist dlh->l NULL wird eine neuer Knoten erzeugt, auf den dlh->l
                    und dlh->f zeigen.
*/
dl_t *dlh_insert_last( dlh_t *dlh )
{
  dl_t *t = NULL;

  if( dlh != NULL ) {
    if( dlh->l == NULL )
      dlh->f = dlh->l = dl_create();
    else {
      t = dl_create();
      dlh->l->n = t;
      t->v = dlh->l;
      dlh->l = t;
    }
    return dlh->l;
  }
  return NULL;
}

/*
  Funktion: dl_t *dlh_insert_first( dlh_t *dlh )

  Eingabeparameter: dlh
                    Kopf einer Doppelt Verkettete Liste mit Allgemeinen Daten.


  Ausgabeparameter: Zeiger auf den neuen Datensatz.

  Funktion:         erzeugt einen neuen knoten und fügt ihn am anfang der Liste ein.
                    Ist dlh->f NULL wird eine neuer Knoten erzeugt, auf den dlh->l
                    und dlh->f zeigen.

*/
dl_t *dlh_insert_first( dlh_t *dlh )
{
  dl_t *t = NULL;

  if( dlh != NULL ) {
    if( dlh->f == NULL )
      dlh->f = dlh->l = dl_create();
    else {
      t = dlh->f;
      dlh->f = dl_create();
      dlh->f->n = t;
      t->v = dlh->f;
    }
  }
  return dlh->f;
}

/*
  Funktion: int  dl_insert_data( dlh_t *dlh, dl_t dl*, int dl_type, void *data, size_t ds, void *udata )

  Eingabeparameter: dlh       Zeiger auf die Liste
                    dl        Zeiger auf einen Knoten in der Liste dlh
                    dl_type   Listentyp (datenformat von "data")
                    data      Zeiger auf die Daten
                    ds        Grösse der Speicherbereiches, auf den "data" zeigt
                    udata     Zeiger auf benutzerdefinierte daten
  Ausgabeparameter: MEM_NO_DATA     Fehler: es wurden keine Daten übergeben
                    MEM_BAD_TYPE    Fehler: Falscher Datentyp in dl_type
                    MEM_NO_ERROR    Alles OK
  Funktion:         Fügt Daten in die liste "dlh" ein
*/
int   dl_insert_data( dlh_t *dlh, dl_t *dl, int dl_type, void *dl_data, size_t ds, void *udata )
{
  dl_t *dli;
  if( dlh != NULL && dl != NULL ) {
    if( dl_type == dlh->dl_type ) {

      // Suche dl in der Liste
      for( dli = dlh->f; dli; dli = dli->n )
        if( dli == dl )
          break;

      // Daten kopieren;
      if( dli != NULL && dl_data != NULL ) {
        dl->data = Malloc(ds);
        dl->udata = udata;
        memcpy( dl->data, dl_data, ds );
      }
      else
        return MEM_NO_DATA;
    }
    else
      return MEM_BAD_TYPE;
  }
  else
    return MEM_NO_DATA;

  return MEM_NO_ERROR;
}

/*
  Funktion:     void * dlh_delete( dlh_t *dlh, dl_t *dl, int dl_type )

  Eingabeparameter: dlh       Zeiger auf die Liste
                    dl        Zeiger auf einen Knoten in der Liste dlh
                    dl_type   Listentyp (datenformat von "data")
                    usrfk     Benutzerdefinierte Funktion, die vor dem
                              löschen der Daten ausgeführt wird.
                    ud        Daten, die an "usrfk" übergeben werden

  Ausgabeparameter: Zeiger auf die Daten "data"
                    "udata" muss ggf VORHER vom Benutzer freigegeben werden.

  Funktion: Löscht einen Knoten aus der liste "dlh"
*/
void * dlh_delete( dlh_t *dlh, dl_t *dl, int dl_type, int (*usrfk)(void*), void *ud )
{
  dl_t *dli, *dlv, *dln;
  void *d = NULL;

  if( dlh == NULL )
    return NULL;

  if( dlh->dl_type != dl_type )
    return NULL;

  // Prüfen, ob dl in der Liste dlh
  for( dli = dlh->f; dli; dli = dli->n ) {
    if( dli == dl )
      break;
  }

  // wenn dl nicht in der Liste ist
  if( dli == NULL )
    return NULL;

  d = dl->data;

  if( usrfk != NULL )
    if ( (*usrfk)(ud) != 0 )
      return NULL;

  if( dl->v == NULL && dl->n == NULL ) { // dl ist der letzte Knoten in der
    Free( dl );                          // Liste
    dlh->f = dlh->l = NULL;
  }
  else {
    if( dl->v == NULL && dl->n != NULL ) { // dl ist der erste Knoten in der Liste
      dl = dl->n;
      Free(dl->v);
      dl->v = NULL;
      dlh->f = dl;
    }
    else {
      if( dl->v != NULL && dl->n == NULL ) { // dl ist der letzte Knoten in der Liste
        dl = dl->v;
        Free(dl->n);
        dl->n = NULL;
        dlh->l = dl;
      }
      else { // dl ist nicht der letzte und nicht der erste Knoten in der Liste
        dln = dl->n;
        dlv = dl->v;
        dln->v = dlv;
        dlv->n = dln;
        Free(dl);
      }
    }
  }
  return d;
}

#if 0
// Debug der Speicherverwaltung
int dl_print_data( dl_t *dl )
{
  fprintf(stderr,"Addr von dl        = %p\n", dl);
  if( dl ) {
    fprintf(stderr,"Addr von dl->n     = %p\n", dl->n);
    fprintf(stderr,"Addr von dl->v     = %p\n", dl->v);
    fprintf(stderr,"Addr von dl->data  = %p\n", dl->data);
  }
  return 0;
}
#endif
