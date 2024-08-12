#ifndef CONTEXT_OBJECT_H
#define CONTEXT_OBJECT_H

#include <node.h>
#include <node_object_wrap.h>

extern "C" {
    #include "nodavesimple.h"
}

namespace nodeS7Serial {

class ContextObject : public node::ObjectWrap {
 public:
  static void Init(v8::Isolate* isolate);
  static void NewInstance(const v8::FunctionCallbackInfo<v8::Value>& args);

  inline _daveOSserialType* getDaveOSserialType(){ return &fds; }
  inline _daveOSserialType getDaveOSserialTypeObj() { return fds; }
  inline daveInterface* getDaveInterface() { return di; }
  inline void setDaveInterface(daveInterface* diIn) { di = diIn; }
  inline daveConnection* getDaveConnection() { return dc; }
  inline void setDaveConnection(daveConnection* dcIn) { dc = dcIn; }
  inline PDU* getPDU() { return &p; }
  inline daveResultSet* getDaveResultSet() { return &rs; }

  inline int getSerialStatus() { return serialStatus; }
  inline void setSerialStatus(int seStatus) { serialStatus = seStatus; }
  inline int getInitializationStatus() { return initializationStatus; }
  inline void setInitializationStatus(int iniStatus) { initializationStatus = iniStatus; }
  inline int getConnectionStatus() { return connectionStatus; }
  inline void setConnectionStatus(int connStatus) { connectionStatus = connStatus; }

 private:
  explicit ContextObject();
  ~ContextObject();

  static void New(const v8::FunctionCallbackInfo<v8::Value>& args);
  static v8::Persistent<v8::Function> constructor;

  // serial file descriptor
  _daveOSserialType fds;
  // context for library
  daveInterface *di;
  daveConnection *dc;
  // required for multi-reads
  PDU p;
  daveResultSet rs;
  // status flags
  int serialStatus;
  int initializationStatus;
  int connectionStatus;

};

}  // namespace nodeS7Serial

#endif
