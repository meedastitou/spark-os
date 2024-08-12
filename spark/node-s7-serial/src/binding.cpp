#include "v8.h"

#include <node.h>
#include <nan.h>
#include <node_object_wrap.h>

extern "C" {
    #include "nodavesimple.h"
    #include "setport.h"
}

#include "context_object.h"

namespace nodeS7Serial {

//using namespace std;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Value;
using Nan::AsyncQueueWorker;
using Nan::AsyncWorker;
using Nan::Callback;
using Nan::New;
using Nan::Null;
using Nan::To;


// read type
#define READ_BIT   0
#define READ_BYTE  1
#define READ_WORD  2
#define READ_DWORD 3

// format
#define  FORMAT_UNSIGNED 0
#define  FORMAT_SIGNED   1
#define  FORMAT_FLOAT    2
#define  FORMAT_BOOL     3

// memory area
#define S7_200_AREA_C    0x1E
#define S7_200_AREA_T    0x1F

void Method_CreateContext(const FunctionCallbackInfo<Value>& args) {
  ContextObject::NewInstance(args);
}


class ConnectPPIWorker : public AsyncWorker {

    public:
        ConnectPPIWorker(Callback *callback, ContextObject* context, std::string device, std::string baudRate, std::string parity, int localAddress, int plcAddress )
        : AsyncWorker(callback)
        {
            localContext = context;
            localDevice = device;
            localBaudRate = baudRate;
            localParity = parity;
            localLocalAddress = localAddress;
            localPlcAddress = plcAddress;
        }

        ~ConnectPPIWorker() {}

        // Executed inside the worker-thread.
        // It is not safe to access V8, or V8 data structures
        // here, so everything we need for input and output
        // should go on `this`.
        void Execute () {

            // initialize the flags
            localContext->setSerialStatus(-1);
            localContext->setInitializationStatus(-1);
            localContext->setConnectionStatus(-1);

            //printf("ConnectPPIWorker: Calling setPort for %s : Baud %s Parity %c \n",localDevice.c_str(), localBaudRate.c_str(), localParity.c_str()[0]);

            _daveOSserialType* fds = localContext->getDaveOSserialType();
            fds->rfd = setPort((char*)localDevice.c_str(), (char*)localBaudRate.c_str(), localParity.c_str()[0]);
            fds->wfd = fds->rfd;
            if (fds->rfd > 0) {
                localContext->setSerialStatus(0);

                //printf("ConnectPPIWorker: Calling daveNewInterface for protocol %d :Speed %d \n",daveProtoPPI, daveSpeed187k);
                daveInterface* di = daveNewInterface(localContext->getDaveOSserialTypeObj(), (char*)"IF1", localLocalAddress, daveProtoPPI, daveSpeed187k);
                localContext->setDaveInterface(di);
                localContext->setInitializationStatus(0); // no need for initialization for ppi
                //daveSetTimeout(di, 5000000);

                //printf("ConnectPPIWorker: Calling daveNewConnection\n");
                daveConnection *dc = daveNewConnection(di, localPlcAddress, 0, 0);
                localContext->setDaveConnection(dc);

                //printf("ConnectPPIWorker: Calling daveConnectPLC\n");
                int connectionStatus = daveConnectPLC(dc);  // 0 == success
                localContext->setConnectionStatus(connectionStatus);
                //printf("ConnectPPIWorker: Got connection result %d\n", connectionStatus);
                if (connectionStatus != 0) {
                    //printf("ConnectPPIWorker: CONNECTION FAILED, so calling daveDisconnectAdapter\n");
                    daveFree(dc);
                    daveDisconnectAdapter(di);
                    daveFree(di);
                    closePort(fds->rfd);
                }
            } else {
                //printf("ConnectPPIWorker: FAILED TO CONNECT SERIAL PORT\n");
            }
        }

        // Executed when the async work is complete
        // this function will be run inside the main event loop
        // so it is safe to use V8 again
        void HandleOKCallback () {

            int serialStatus = localContext->getSerialStatus();
            int connectionStatus = localContext->getConnectionStatus();

            if ((serialStatus == 0) && (connectionStatus == 0)){
                Local<Value> argv[] = {
                    Null(),
                    Null()
                };
                //printf("ConnectPPIWorker: HandleOKCallback\n");
                callback->Call(2, argv);
            } else {
                char errorMsg[200];
                sprintf(errorMsg,"Error Connecting over serial PPI. Return codes: Serial = %i Connection = %i\n", serialStatus, connectionStatus);
                Local<Value> argv[] = {
                    Nan::Error(errorMsg),
                    Null()
                };
                callback->Call(2, argv);
            }
        }

    private:
        ContextObject* localContext;
        std::string localDevice;
        std::string localBaudRate;
        std::string localParity;
        int localLocalAddress;
        int localPlcAddress;
};

/******************************************************************************
*
*  Function: 			Method_ConnectPPI()
*  Sync/Async:			ASync
*  Parameters: info[0] -- context object
*              info[1] -- string  serialDevice
*              info[2] -- string  serialBaud
*			   info[3] -- string  serialParity
*			   info[4] -- number  localAddress
*			   info[5] -- number  plcAddress
*              info[6] -- ASync Callback
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_ConnectPPI) {

  // Check the number of arguments passed.
  if (info.Length() != 7)
  {
      Nan::ThrowTypeError("Wrong number of arguments");
      return;
  }
  // and their types
  if (!info[0]->IsObject()||!info[1]->IsString()||!info[2]->IsString()||!info[3]->IsString()||!info[4]->IsNumber()||!info[5]->IsNumber()||!info[6]->IsObject()) {
      Nan::ThrowTypeError("One or more arguments of the wrong type");
      return;
  }

  ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());

  v8::String::Utf8Value arg0(info[1]->ToString());
  std::string device = std::string(*arg0);

  v8::String::Utf8Value arg1(info[2]->ToString());
  std::string baudRate = std::string(*arg1);

  v8::String::Utf8Value arg2(info[3]->ToString());
  std::string parity = std::string(*arg2);

  int localAddress = (int)info[4]->NumberValue();
  int plcAddress = (int)info[5]->NumberValue();

  Callback *callback = new Callback(info[6].As<v8::Function>());

  AsyncQueueWorker(new ConnectPPIWorker(callback, context, device, baudRate, parity, localAddress, plcAddress));
}



class ConnectMPIWorker : public AsyncWorker {

    public:
        ConnectMPIWorker(Callback *callback, ContextObject* context, std::string device, std::string baudRate, std::string parity, int mpiMode, int mpiSpeed, int localAddress, int plcAddress )
        : AsyncWorker(callback)
        {
            localContext = context;
            localDevice = device;
            localBaudRate = baudRate;
            localParity = parity;
            localMpiMode = mpiMode;
            localLocalAddress = localAddress;
            localPlcAddress = plcAddress;
        }

        ~ConnectMPIWorker() {}

        // Executed inside the worker-thread.
        // It is not safe to access V8, or V8 data structures
        // here, so everything we need for input and output
        // should go on `this`.
        void Execute () {

            // initialize the flags
            int initializationStatus = -1;
            int connectionStatus = -1;
            int serialStatus = -1;
            localContext->setSerialStatus(serialStatus);
            localContext->setInitializationStatus(initializationStatus);
            localContext->setConnectionStatus(connectionStatus);

            daveInterface* di;
            daveConnection *dc;

            //printf("ConnectMPIWorker: Calling setPort for %s : Baud %s Parity %c \n",localDevice.c_str(), localBaudRate.c_str(), localParity.c_str()[0]);

            _daveOSserialType* fds = localContext->getDaveOSserialType();
            fds->rfd = setPort((char*)localDevice.c_str(), (char*)localBaudRate.c_str(), localParity.c_str()[0]);
            fds->wfd = fds->rfd;
            if (fds->rfd > 0) {
                localContext->setSerialStatus(0);

                //printf("ConnectMPIWorker: Calling daveNewInterface for protocol %d :Speed %d \n",localMpiMode, localMpiSpeed);
                di = daveNewInterface(localContext->getDaveOSserialTypeObj(), (char*)"IF1", localLocalAddress, localMpiMode, localMpiSpeed);
                localContext->setDaveInterface(di);
                daveSetTimeout(di, 5000000);

                //printf("ConnectMPIWorker: Calling daveInitAdapter\n");
                initializationStatus = daveInitAdapter(di); // 0 == success
                localContext->setInitializationStatus(initializationStatus);

                if (initializationStatus == 0) {
                    //printf("ConnectMPIWorker: Calling daveNewConnection\n");
                    dc = daveNewConnection(di, localPlcAddress, 0, 0);
                    localContext->setDaveConnection(dc);

                    //printf("ConnectMPIWorker: Calling daveConnectPLC\n");
                    connectionStatus = daveConnectPLC(dc);  // 0 == success
                    localContext->setConnectionStatus(connectionStatus);
                    //printf("ConnectMPIWorker: Got connection result %d\n", connectionStatus);

                    if (connectionStatus != 0) {
                        //printf("ConnectMPIWorker: CONNECTION FAILED, so calling daveDisconnectAdapter\n");
                        daveFree(dc);
                        daveDisconnectAdapter(di);
                        daveFree(di);
                        closePort(fds->rfd);
                    }
                } else {
                    //printf("ConnectMPIWorker: Initialization attempt failed. Calling daveDisconnectAdapter\n");
                    daveDisconnectAdapter(di);
                }

            } else {
                //printf("ConnectMPIWorker: FAILED TO CONNECT SERIAL PORT\n");
            }
        }

        // Executed when the async work is complete
        // this function will be run inside the main event loop
        // so it is safe to use V8 again
        void HandleOKCallback () {

            int serialStatus = localContext->getSerialStatus();
            int initializationStatus = localContext->getInitializationStatus();
            int connectionStatus = localContext->getConnectionStatus();

            if ((serialStatus == 0) && (initializationStatus == 0) && (connectionStatus == 0)){
                Local<Value> argv[] = {
                    Null(),
                    Null()
                };
                callback->Call(2, argv);
            } else {
                char errorMsg[200];
                sprintf(errorMsg,"Error Connecting over serial MPI. Return codes: Serial = %i Initialization = %i Connection = %i\n", serialStatus, initializationStatus, connectionStatus);
                Local<Value> argv[] = {
                    Nan::Error(errorMsg),
                    Null()
                };
                callback->Call(2, argv);
            }
        }

    private:
        ContextObject* localContext;
        std::string localDevice;
        std::string localBaudRate;
        std::string localParity;
        int localMpiMode;
        int localMpiSpeed;
        int localLocalAddress;
        int localPlcAddress;

};

/******************************************************************************
*
*  Function: 			Method_ConnectMPI()
*  Sync/Async:			ASync
*  Parameters: info[0] -- context object
*              info[1] -- string  serialDevice
*              info[2] -- string  serialBaud
*			   info[3] -- string  serialParity
*			   info[4] -- number  mpiMode
*			   info[5] -- number  mpiSpeed
*			   info[6] -- number  localAddress
*			   info[7] -- number  plcAddress
*              info[8] -- ASync Callback
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_ConnectMPI) {

  // Check the number of arguments passed.
  if (info.Length() != 9)
  {
      Nan::ThrowTypeError("Wrong number of arguments");
      return;
  }
  // and their types
  if (!info[0]->IsObject()||!info[1]->IsString()||!info[2]->IsString()||!info[3]->IsString()||!info[4]->IsNumber()||!info[5]->IsNumber()||!info[6]->IsNumber()||!info[7]->IsNumber()||!info[8]->IsObject()) {
      Nan::ThrowTypeError("One or more arguments of the wrong type");
      return;
  }

  ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());

  v8::String::Utf8Value arg0(info[1]->ToString());
  std::string device = std::string(*arg0);

  v8::String::Utf8Value arg1(info[2]->ToString());
  std::string baudRate = std::string(*arg1);

  v8::String::Utf8Value arg2(info[3]->ToString());
  std::string parity = std::string(*arg2);

  int mpiMode = (int)info[4]->NumberValue();
  int mpiSpeed = (int)info[5]->NumberValue();

  int localAddress = (int)info[6]->NumberValue();
  int plcAddress = (int)info[7]->NumberValue();

  Callback *callback = new Callback(info[8].As<v8::Function>());

  AsyncQueueWorker(new ConnectMPIWorker(callback, context, device, baudRate, parity, mpiMode, mpiSpeed, localAddress, plcAddress));
}


class DisconnectWorker : public AsyncWorker {

    public:
        DisconnectWorker(Callback *callback, ContextObject* context)
        : AsyncWorker(callback) {
            localContext = context;
        }

        ~DisconnectWorker() {}

        // Executed inside the worker-thread.
        // It is not safe to access V8, or V8 data structures
        // here, so everything we need for input and output
        // should go on `this`.
        void Execute () {

            // if connected successfuly, disconnect plc
            if (localContext->getConnectionStatus() == 0) {
                //printf("DisconnectWorker: calling daveDisconnectPLC and daveFree\n");
                daveConnection* dc = localContext->getDaveConnection();
                daveDisconnectPLC(dc);
                daveFree(dc);
                localContext->setConnectionStatus(-1);
            }

            // if initialized successfuly, disconnect adapter
            if(localContext->getInitializationStatus() == 0 ) {
                //printf("DisconnectWorker: calling daveDisconnectAdapter and daveFree\n");
                daveInterface* di = localContext->getDaveInterface();
                daveDisconnectAdapter(di);
            	daveFree(di);
                localContext->setInitializationStatus(-1);
            }

            // if serial connection active, close it
            if(localContext->getSerialStatus() == 0 ) {
                //printf("DisconnectWorker: calling closePort\n");
                _daveOSserialType* fds = localContext->getDaveOSserialType();
                closePort(fds->rfd);
                localContext->setSerialStatus(-1);
            }
        }

        // Executed when the async work is complete
        // this function will be run inside the main event loop
        // so it is safe to use V8 again
        void HandleOKCallback () {
            //printf("DisconnectWorker: HandleOKCallback\n");

            Local<Value> argv[] = {
                Null(),
                Null()
            };
            callback->Call(2, argv);
        }

    private:
        ContextObject* localContext;

};

/******************************************************************************
*
*  Function: 			Method_Disconnect()
*  Sync/Async:			ASync
*  Parameters: info[0] -- context object
*              info[1] -- ASync Callback
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_Disconnect) {

  // Check the number of arguments passed.
  if (info.Length() != 2)
  {
      Nan::ThrowTypeError("Wrong number of arguments");
      return;
  }
  // and their types
  if (!info[0]->IsObject() || !info[1]->IsObject()) {
      Nan::ThrowTypeError("One or more arguments of the wrong type");
      return;
  }

  ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
  Callback *callback = new Callback(info[1].As<v8::Function>());

  AsyncQueueWorker(new DisconnectWorker(callback, context));
}




/******************************************************************************
*
*  Function: 			Method_PrepareReadRequest()
*  Sync/Async:			Synchronous
*  Parameters: info[0] -- context object
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_PrepareReadRequest) {

    // Check the number of arguments passed.
    if (info.Length() != 1)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if (!info[0]->IsObject()) {
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    // get necessary context
    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    PDU* p = context->getPDU();
    daveConnection* dc = context->getDaveConnection();

    //printf("PrepareReadRequest: calling davePrepareReadRequest\n");
    davePrepareReadRequest(dc, p);
}

/******************************************************************************
*
*  Function: 			Method_AddVarToRequest()
*  Sync/Async:			Synchronous
*  Parameters: info[0] -- context object
*              info[1] -- number  data type to read
*              info[2] -- number  memory area
*			   info[3] -- number  block index
*			   info[4] -- number  start address
*			   info[5] -- number  length
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_AddVarToRequest) {

    // Check the number of arguments passed.
    if (info.Length() != 6)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if (!info[0]->IsObject() || !info[1]->IsNumber() || !info[2]->IsNumber() || !info[3]->IsNumber() || !info[4]->IsNumber() || !info[5]->IsNumber()) {
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    int dataType = (int)info[1]->NumberValue();
    int memoryArea = (int)info[2]->NumberValue();
    int blockIndex = (int)info[3]->NumberValue();
    int startAddress = (int)info[4]->NumberValue();
    int length = (int)info[5]->NumberValue();

    // get necessary context
    PDU* p = context->getPDU();

    if( dataType == READ_BIT) {
        //printf("AddVarToRequest: calling daveAddBitVarToReadRequest : Memory Area %d : Block Index %d: Start Address %d : Length %d \n", memoryArea, blockIndex, startAddress, length);
        daveAddBitVarToReadRequest(p, memoryArea, blockIndex, startAddress, length);
    } else {
        //printf("AddVarToRequest: calling daveAddVarToReadRequest : Memory Area %d : Block Index %d: Start Address %d : Length %d \n", memoryArea, blockIndex, startAddress, length);
        daveAddVarToReadRequest(p, memoryArea, blockIndex, startAddress, length);
    }
}


class ExecReadRequestWorker : public AsyncWorker {

    public:
        ExecReadRequestWorker(Callback *callback, ContextObject* context)
        : AsyncWorker(callback) {
            // get necessary context
            dc = context->getDaveConnection();
            p = context->getPDU();
            rs = context->getDaveResultSet();
        }

        ~ExecReadRequestWorker() {}

        // Executed inside the worker-thread.
        // It is not safe to access V8, or V8 data structures
        // here, so everything we need for input and output
        // should go on `this`.
        void Execute () {

            //printf("ExecReadRequestWorker: calling daveExecReadRequest\n");
            result = daveExecReadRequest(dc, p, rs);
        }

        // Executed when the async work is complete
        // this function will be run inside the main event loop
        // so it is safe to use V8 again
        void HandleOKCallback () {
            //printf("ExecReadRequestWorker: HandleOKCallback Result %d\n" , result);

            if (result == daveResOK) {
                Local<Value> argv[] = {
                    Null(),
                    Null()
                };
                callback->Call(2, argv);
            } else {
                char errorMsg[200];
                sprintf(errorMsg,"Error Executing Read Request. Return code = %i\n", result);
                Local<Value> argv[] = {
                    Nan::Error(errorMsg),
                    Null()
                };
                callback->Call(2, argv);
            }
        }

    private:
        daveConnection* dc;
        PDU* p;
        daveResultSet* rs;
        int result;
};

/******************************************************************************
*
*  Function: 			Method_ExecReadRequest()
*  Sync/Async:			ASync
*  Parameters: info[0] -- context object
*              info[1] -- ASync Callback
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_ExecReadRequest) {

  // Check the number of arguments passed.
  if (info.Length() != 2)
  {
      Nan::ThrowTypeError("Wrong number of arguments");
      return;
  }
  // and their types
  if (!info[0]->IsObject() || !info[1]->IsObject()) {
      Nan::ThrowTypeError("One or more arguments of the wrong type");
      return;
  }

  ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
  Callback *callback = new Callback(info[1].As<v8::Function>());

  AsyncQueueWorker(new ExecReadRequestWorker(callback, context));
}



/******************************************************************************
*
*  Function: 			Method_GetResult()
*  Sync/Async:			Synchronous
*  Parameters: info[0] -- context object
*              info[1] -- number  index
*              info[2] -- number  data type to read
*              info[3] -- number  data format to read
*
*  Returns: Indexed result or null.
*
******************************************************************************/
NAN_METHOD(Method_GetResult) {

    // Check the number of arguments passed.
    if (info.Length() != 5)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if (!info[0]->IsObject() || !info[1]->IsNumber() || !info[2]->IsNumber() || !info[3]->IsNumber() || !info[4]->IsNumber()) {
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    int index = (int)info[1]->NumberValue();
    int readType = (int)info[2]->NumberValue();
    int readFormat = (int)info[3]->NumberValue();
    int readMemoryArea = (int)info[4]->NumberValue();

    // get necessary context
    daveConnection* dc = context->getDaveConnection();
    daveResultSet* rs = context->getDaveResultSet();

    int result = 0;
    float resultFloat = 0.0;
    //printf("GetResult: daveUseResult for Index %d With Read Type %d and format %d \n", index, readType, readFormat);

    // point to the correct result using the passed in index
    int res = daveUseResult(dc, rs, index);
    // if result exists
    if (res == 0) {
        // get based on type (should handle the conversion from bigendian to little endian where applicable)
        if(readType == READ_BIT) {
            // get bit as an unsigned 8 bit and convert to bool
            result = daveGetU8(dc);
        } else if (readType == READ_BYTE) {
            // get it as a Signed or unsigned 8 bit
            result = (readFormat == FORMAT_SIGNED) ? daveGetS8(dc) : daveGetU8(dc);
        } else if (readType == READ_WORD) {
            if (readMemoryArea == S7_200_AREA_C) {
                // for S7_200_AREA_C, we have discovered that the location of the data in the returned string is not in the
                // expected position.  Normally we decode the result from the data immediately following the length bytes.  This is
                // the location pointed to by dc->resultPointer.  For the following example:
                // PACKET:              FF 09 00 06 00 12 34 00 00 00
                //    length bytes:          <00 06>
                //    dc->resultPointer             ^^
                // however, the actual data value (0x1234) is actually 1 byte past this.  In the absense of confirming documentation,
                // we have specultated that this due to status information before and after the actual data value.  Watching the
                // same read request via a kepware client appears to show the availability of status information, but we cannot determine
                // where it is in the packet.
                // As such, we instead use daveGetxxAt routines to allow us to index to this location.
                result = (readFormat == FORMAT_SIGNED) ? daveGetS16At(dc, 1) : daveGetU16At(dc, 1);
            } else if (readMemoryArea == S7_200_AREA_T) {
                // similar to S7_200_AREA_C, the S7_200_AREA_T memory area also returns its data in a different portion of the packet.
                // the example for this value is:
                // PACKET:              FF 09 00 0A 00 00 00 12 34 00 00 00 00 00
                //    length bytes:          <00 06>
                //    dc->resultPointer             ^^
                // in this case, it appears that we need to add three bytes to get to the data location.  However, we are unable to
                // load a value into the PLC for these registers larger than 16 bits.  It is possible that we still only need the
                // 1-byte offset, and that the two zeros preceding the data are actually the high-order bytes of a 32-bit value.
                // If this is true, however, other changes are required to this library, since it automatically forces any reads of
                // S7_200_AREA_C and S7_200_AREA_T to be READ_WORD:
                //      from 'NodeS7Serial.prototype.addItems' in 'spark/node-s7-serial/index.js':
                //          // no read type included for the timers and counters, they are 16 bit accesses
                // For now, leave as an index of 3, resulting in our always reading a 16-bit result for counters and timers.
                result = (readFormat == FORMAT_SIGNED) ? daveGetS16At(dc, 3) : daveGetU16At(dc, 3);
            } else {
                result = (readFormat == FORMAT_SIGNED) ? daveGetS16(dc) : daveGetU16(dc);
            }// get it as a Signed or unsigned 16 bit
        } else if (readType == READ_DWORD) {
            // get it as a Signed or unsigned 32 bit, or float
            if( readFormat == FORMAT_SIGNED) {
                result = daveGetS32(dc);
            } else if (readFormat == FORMAT_UNSIGNED) {
                result = daveGetU32(dc);
            } else {
                resultFloat = daveGetFloat(dc);
            }
        }

        // convert it to applicable v8 type and set it as return value
        if( readFormat == FORMAT_FLOAT) {
            v8::Local<v8::Number> resultV8Float = Nan::New<v8::Number>(resultFloat);
            info.GetReturnValue().Set(resultV8Float);
        } else if( readFormat == FORMAT_BOOL) {
            v8::Local<v8::Boolean> resultV8Bool = Nan::New<v8::Boolean>((bool)(result > 0));
            info.GetReturnValue().Set(resultV8Bool);
        } else {
            v8::Local<v8::Integer> resultV8Int = Nan::New<v8::Integer>(result);
            info.GetReturnValue().Set(resultV8Int);
        }
    } else {
        // if no value, create a v8 null and set it as the return value
        v8::Local<v8::Primitive> returnNull = Nan::Null();
        info.GetReturnValue().Set(returnNull);
    }
}

/******************************************************************************
*
*  Function: 			Method_FreeResults()
*  Sync/Async:			Synchronous
*  Parameters: info[0] -- context object
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_FreeResults) {
    // Check the number of arguments passed.
    if (info.Length() != 1)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if (!info[0]->IsObject()) {
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());

    //printf("FreeResults: Calling daveFreeResults\n");
    daveFreeResults(context->getDaveResultSet());
    //printf("FreeResults: Return from daveFreeResults\n");
}

/*******************************************************************************
 *
 * Function:    Method_PrepareWriteRequest
 * Sync/Async:  Synchronous
 * Parameters:
 *
 * Returns: Nothing.
 *
 /******************************************************************************/
NAN_METHOD(Method_PrepareWriteRequest){

    //Check the number of arguments passed
    if(info.Length() != 1)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if(!info[0]->IsObject()){
        Nan::ThrowTypeError("One or more arguements of the wrong type");
        return;
    }
    //get necessary context
    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    PDU* p = context->getPDU();
    daveConnection* dc = context->getDaveConnection();

    davePrepareWriteRequest(dc, p);
}
/*******************************************************************************
 *
 * Function:    Method_AddWriteVarToRequest
 * Sync/Async:  Synchronous
 *  Parameters: info[0] -- context object
 *              info[1] -- number  data type to read
 *              info[2] -- number  memory area
 *			    info[3] -- number  block index
 *			    info[4] -- number  start address
 *			    info[5] -- number  length
 *
 * Returns: Nothing.
 *
 /******************************************************************************/
 NAN_METHOD(Method_AddWriteVarToRequest){

    // Check the number of arguments passed.
    if (info.Length() != 7)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if (!info[0]->IsObject() || !info[1]->IsNumber() || !info[2]->IsNumber() || !info[3]->IsNumber() || !info[4]->IsNumber() || !info[5]->IsNumber()) {
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    int dataType = (int)info[1]->NumberValue();
    int memoryArea = (int)info[2]->NumberValue();
    int blockIndex = (int)info[3]->NumberValue();
    int startAddress = (int)info[4]->NumberValue();
    int length = (int)info[5]->NumberValue();

    void * da = (void *)node::Buffer::Data(info[6]->ToObject());
    // get necessary context
    PDU* p = context->getPDU();

    if( dataType == READ_BIT) {
        //printf("AddVarToWrite READ_BIT Request: calling daveAddBitVarToReadRequest : Memory Area %d : Block Index %d: Start Address %d : Length %d \n", memoryArea, blockIndex, startAddress, length);
        daveAddBitVarToWriteRequest(p, memoryArea, blockIndex, startAddress, length, da);
    } else {
        //printf("AddVarToWrite ELSE Request: calling daveAddVarToReadRequest : Memory Area %d : Block Index %d: Start Address %d : Length %d \n", memoryArea, blockIndex, startAddress, length);
        daveAddVarToWriteRequest(p, memoryArea, blockIndex, startAddress, length, da);
    }
}

class ExecWriteRequestWorker : public AsyncWorker {

    public:
        ExecWriteRequestWorker(Callback *callback, ContextObject* context)
        : AsyncWorker(callback) {
            //get necessary context
            dc = context->getDaveConnection();
            p = context->getPDU();
            rs = context->getDaveResultSet();
        }

        ~ExecWriteRequestWorker() {}

        // Executed inside the worker-thread
        // It is not safe to access V8, or V8 data structures
        // here, so everything we need for input and output
        // should go on `this`.
        void Execute () {

            result = daveExecWriteRequest(dc, p, rs);
        }

        // Executed when the async work is complete
        // this function will be run inside the main event loop
        // so it is safe to use V8 again
        void HandleOKCallback () {

            if(result == daveResOK){
                Local<Value> argv[] = {
                    Null(),
                    Null()
                };
                callback->Call(2, argv);
            } else {
                char errorMsg[200];
                sprintf(errorMsg, "Error Executing Write Request. Return code = %i\n", result);
                Local<Value> argv[] = {
                    Nan::Error(errorMsg),
                    Null()
                };
                callback->Call(2, argv);
            }
        }
    private:
        daveConnection* dc;
        PDU* p;
        daveResultSet* rs;
        int result;
};

/******************************************************************************
*
*  Function: 			Method_ExecWriteRequest()
*  Sync/Async:			ASync
*  Parameters: info[0] -- context object
*              info[1] -- ASync Callback
*
*  Returns: Nothing.
*
******************************************************************************/
NAN_METHOD(Method_ExecWriteRequest){

    //Check the number of arguements passed
    if(info.Length() != 2)
    {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }
    // and their types
    if(!info[0]->IsObject() || !info[1]->IsObject() ){
        Nan::ThrowTypeError("One or more arguments of the wrong type");
        return;
    }

    ContextObject* context = node::ObjectWrap::Unwrap<ContextObject>(info[0]->ToObject());
    Callback *callback = new Callback(info[1].As<v8::Function>());

    AsyncQueueWorker(new ExecWriteRequestWorker(callback, context));
}

void init(v8::Local<v8::Object> target) {

    ContextObject::Init(target->GetIsolate());

    NODE_SET_METHOD(target, "createContext", Method_CreateContext);
    target->Set(Nan::New("connectPPI").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_ConnectPPI)->GetFunction());                  // ASYNC Function
    target->Set(Nan::New("connectMPI").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_ConnectMPI)->GetFunction());                  // ASYNC Function
    target->Set(Nan::New("disconnect").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_Disconnect)->GetFunction());                  // ASYNC Function
    target->Set(Nan::New("prepareReadRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_PrepareReadRequest)->GetFunction());
    target->Set(Nan::New("addVarToRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_AddVarToRequest)->GetFunction());
    target->Set(Nan::New("execReadRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_ExecReadRequest)->GetFunction());        // ASYNC Function
    target->Set(Nan::New("getResult").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_GetResult)->GetFunction());
    target->Set(Nan::New("freeResults").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_FreeResults)->GetFunction());
    target->Set(Nan::New("prepareWriteRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_PrepareWriteRequest)->GetFunction());
    target->Set(Nan::New("addWriteVarToRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_AddWriteVarToRequest)->GetFunction());
    target->Set(Nan::New("execWriteRequest").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_ExecWriteRequest)->GetFunction());
}

NODE_MODULE(binding, init);

}  // namespace nodeS7Serial
