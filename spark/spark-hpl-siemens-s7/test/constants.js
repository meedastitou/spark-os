
// S7-200 Memory areas for PPI
module.exports.S7_200_AREA_I = 0x81; // Process-image Input Register
module.exports.S7_200_AREA_Q = 0x82; // Process-image Output Register
module.exports.S7_200_AREA_M = 0x83; // Bit Memory Area
module.exports.S7_200_AREA_V = 0x84; // Variable Memory Area (with block number set to 1)
module.exports.S7_200_AREA_C = 0x1E; // Counter Memory Area
module.exports.S7_200_AREA_T = 0x1F; // Timer Memory Area
module.exports.S7_200_AREA_AI = 0x6; // Analog Inputs
module.exports.S7_200_AREA_AQ = 0x7; // Analog Outputs

// S7-300 Memory areas for MPI
module.exports.S7_300_AREA_I = 0x81; // Process-image Input Register
module.exports.S7_300_AREA_Q = 0x82; // Process-image Output Register
module.exports.S7_300_AREA_M = 0x83; // Bit Memory Area (F)
module.exports.S7_300_AREA_DB = 0x84; // Data Block Memory Area (with block number set to n)
module.exports.S7_300_AREA_DI = 0x85; // Instance Data Blocks (NOT TESTED)
module.exports.S7_300_AREA_L = 0x86; // Local Data (NOT TESTED)
module.exports.S7_300_AREA_C = 0x1C; // Counter Memory Area
module.exports.S7_300_AREA_T = 0x1D; // Timer Memory Area

// PPI convert area code to address
module.exports.ppiAreaTranslate = {
  I: module.exports.S7_200_AREA_I,
  Q: module.exports.S7_200_AREA_Q,
  M: module.exports.S7_200_AREA_M,
  V: module.exports.S7_200_AREA_V,
  C: module.exports.S7_200_AREA_C,
  T: module.exports.S7_200_AREA_T,
  AI: module.exports.S7_200_AREA_AI,
  AQ: module.exports.S7_200_AREA_AQ,
};

// MPI convert area code to address
module.exports.mpiAreaTranslate = {
  I: module.exports.S7_300_AREA_I,
  Q: module.exports.S7_300_AREA_Q,
  M: module.exports.S7_300_AREA_M,
  DB: module.exports.S7_300_AREA_DB,
  DI: module.exports.S7_300_AREA_DI,
  L: module.exports.S7_300_AREA_L,
  C: module.exports.S7_300_AREA_C,
  T: module.exports.S7_300_AREA_T,
};

// read type
module.exports.READ_BIT = 0;
module.exports.READ_BYTE = 1;
module.exports.READ_WORD = 2;
module.exports.READ_DWORD = 3;

// format
module.exports.FORMAT_UNSIGNED = 0;
module.exports.FORMAT_SIGNED = 1;
module.exports.FORMAT_FLOAT = 2;
module.exports.FORMAT_BOOL = 3;


// MPI versions (should match as defined in nodavesimple.h)
module.exports.mpiModeTranslate = {
  'MPI v1': 0, // MPI for S7 300/400
  'MPI v2': 1, // MPI for S7 300/400, "Andrew's version"
  'MPI v3': 2, // MPI for S7 300/400, Step 7 Version, not well tested
  'MPI v4': 3, // MPI for S7 300/400, "Andrew's version" with extra STX
};

// MPI Speeds (should match as defined in nodavesimple.h)
module.exports.mpiSpeedTranslate = {
  '9K': 0,
  '19K': 1,
  '187K': 2,
  '500K': 3,
  '1500K': 4,
  '45K': 5,
  '93K': 6,
};
