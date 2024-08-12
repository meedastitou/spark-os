var path = require('path');
var ffi = require('ffi');
var ref = require('ref');
var Struct = require('ref-struct');

var sps_system_parameter = Struct({
    'AddrESF': ref.types.ushort,
    'AddrASF': ref.types.ushort,
    'AddrPAE_Digital': ref.types.ushort,
    'AddrPAA_Digital': ref.types.ushort,
    'AddrMerker': ref.types.ushort,
    'AddrZeiten': ref.types.ushort,
    'AddrZaehler': ref.types.ushort,
    'AddrSystemDaten': ref.types.ushort,
    'AG_sw_version': ref.types.uchar,
    'StatusKennung': ref.types.uchar,
    'AddrEndRam': ref.types.ushort,
    'SystemProgRam': ref.types.ushort,
    'Laenge_DB_liste': ref.types.ushort,
    'Laenge_SB_Liste': ref.types.ushort,
    'Laenge_PB_Liste': ref.types.ushort,
    'Laenge_FB_Liste': ref.types.ushort,
    'Laenge_OB_Liste': ref.types.ushort,
    'Laenge_FX_Liste': ref.types.ushort,
    'Laenge_DX_Liste': ref.types.ushort,
    'Laenge_DB0_Liste': ref.types.ushort,
    'CPU_Kennung2': ref.types.uchar,
    'Steckplatzkenng': ref.types.uchar,
    'BstKopfLaenge': ref.types.ushort,
    'unbek_7': ref.types.uchar,
    'CPU_Kennung': ref.types.uchar,
    'unbek_8': ref.types.ushort,
    'unbek_9': ref.types.ushort,
    'unbek_10': ref.types.ushort
});

var spspar = Struct({
    'laenge': ref.types.ulong,
    'sp': ref.refType(sps_system_parameter)
});

var ag = Struct({
    'cpu_typ': ref.types.ushort,
    'ag_typ': ref.types.ushort,
    'cpu': ref.types.CString
});

var bal = Struct({
    'laenge': ref.types.ulong,
    'ptr': ref.refType(ref.types.ushort)
});

var modinfo = Struct({
    'ram_adresse': ref.types.ushort,
    'baustein_sync1': ref.types.uchar,
    'baustein_sync2': ref.types.uchar,
    'bst': Struct({
        'btyp': ref.types.uint,
        'bok': ref.types.uint
    }),
    'baustein_nummer': ref.types.uchar,
    'pg_kennung': ref.types.uchar,
    'bib_nummer1': ref.types.uchar,
    'bib_nummer2': ref.types.uchar,
    'bib_nummer3': ref.types.uchar,
    'laenge': ref.types.ushort
});

var kopf = Struct({
    'baustein_sync1': ref.types.uchar,
    'baustein_sync2': ref.types.uchar,
    'bst': Struct({
        'btyp': ref.types.uint,
        'bok': ref.types.uint
    }),
    'baustein_nummer': ref.types.uchar,
    'pg_kennung': ref.types.uchar,
    'bib_nummer1': ref.types.uchar,
    'bib_nummer2': ref.types.uchar,
    'bib_nummer3': ref.types.uchar,
    'laenge': ref.types.ushort
});

var bs = Struct({
    'laenge': ref.types.ulong,
    'ptr': ref.refType(ref.types.uchar),
    'kopf': kopf
});

var sps_ram = Struct({
    'laenge': ref.types.ulong,
    'ptr': ref.refType(ref.types.uchar)
});

var raminfo = Struct({
    'start_ram': ref.types.ushort,
    'begin_free_ram': ref.types.ushort,
    'end_ram': ref.types.ushort
});

var libas511Path = path.join(__dirname, 'build', 'Release', 'as511');

var as511 = ffi.Library(libas511Path, {
    'open_tty': ['pointer', ['string']],
    'close_tty': ['int', ['pointer']],
    'as511_read_system_parameter': [ref.refType(spspar), ['pointer']],
    'as511_read_system_parameter_free': ['void', ['pointer', ref.refType(spspar)]],
    'as511_get_ag_typ': [ref.refType(ag), ['pointer', ref.refType(spspar)]],
    'as511_read_module_addr_list': [ref.refType(bal), ['pointer', ref.types.uchar]],
    'as511_read_module_addr_list_free': ['void', ['pointer', ref.refType(bal)]],
    'as511_read_module_info': [ref.refType(modinfo), ['pointer', ref.types.uchar, ref.types.uchar]],
    'as511_read_module_info_free': ['void', ['pointer', ref.refType(modinfo)]],
    'as511_read_module': [ref.refType(bs), ['pointer', ref.types.uchar, ref.types.uchar]],
    'as511_read_module_free': ['void', ['pointer', ref.refType(bs)]],
    'as511_read_ram': [ref.refType(sps_ram), ['pointer', ref.types.ushort, ref.types.ushort]],
    'as511_read_ram32': [ref.refType(sps_ram), ['pointer', ref.types.ulong, ref.types.ulong]],
    'as511_read_ram_free': ['void', ['pointer', ref.refType(sps_ram)]],
    'as511_read_ram_info': [ref.refType(raminfo), ['pointer']],
    'as511_ag_run': [ref.types.int, ['pointer']],
    'as511_ag_stop': [ref.types.int, ['pointer']],
    'as511_change_operating_mode': [ref.types.int, ['pointer', ref.types.uchar]],
    'as511_write_ram': ['int', ['pointer', ref.types.ushort, ref.types.ushort, ref.refType(ref.types.uchar)]]
});

module.exports = as511;
