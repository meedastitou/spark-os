#                                               -*- Autoconf -*-
# Process this file with autoconf to produce a configure script.

AC_PREREQ([2.68])
AC_INIT([as511],[0.0.0],[mail@to-me.de])
AC_CONFIG_SRCDIR([demo/main.h])
AM_INIT_AUTOMAKE([-Wall -Werror foreign])
m4_ifdef([AM_PROG_AR], [AM_PROG_AR])

# Checks for programs.
AC_PROG_CC
AC_PROG_INSTALL
AC_PROG_LN_S
LT_INIT

# Checks for libraries.
AC_CHECK_LIB([popt], [main])

# Checks for header files.
AC_CHECK_HEADERS([fcntl.h stdlib.h string.h sys/time.h termios.h unistd.h])

# Checks for typedefs, structures, and compiler characteristics.
AC_HEADER_STDBOOL
AC_TYPE_SIZE_T

# Checks for library functions.
AC_FUNC_MALLOC
AC_CHECK_FUNCS([memset strcasecmp])

AC_CONFIG_FILES([Makefile
                 src/Makefile
                 demo/Makefile
                 doc/Makefile])
AC_OUTPUT
