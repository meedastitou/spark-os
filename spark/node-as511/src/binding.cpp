#include <nan.h>

#include <setjmp.h>
extern "C" {
    #include <as511_s5lib.h>
    #include <as511_ustack.h>
}

td_t *td = NULL;

NAN_METHOD(Method_OpenSync) {

    if (info.Length() < 1) {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }

    if (!info[0]->IsString()) {
        Nan::ThrowTypeError("Wrong arguments");
        return;
    }

    v8::String::Utf8Value arg0(info[0]->ToString());
    std::string device = std::string(*arg0);

    td = open_tty((char*)device.c_str());
    if (!td) {
        std::string err = "Failed to open ";
        err.append(device);
        Nan::ThrowTypeError(err.c_str());
        return;
    }

    // Uncomment to enable full debug from libas511
    //td->debug_level = DEBUG_LEVEL_ALL;

    info.GetReturnValue().Set(true);
}

NAN_METHOD(Method_CloseSync) {

    if (td == NULL) {
        Nan::ThrowTypeError("Not Open");
        return;
    }

    close_tty(td);
    td = NULL;

    info.GetReturnValue().Set(true);
}

NAN_METHOD(Method_ReadSync) {
    if (td == NULL) {
        Nan::ThrowTypeError("Not Open");
        return;
    }

    if (info.Length() < 2) {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }

    if (!info[0]->IsNumber() || !info[1]->IsNumber()) {
        Nan::ThrowTypeError("Wrong arguments");
        return;
    }

    ram_t *ram;
    ram = as511_read_ram(td, (word_t)info[0]->NumberValue(), (word_t)info[1]->NumberValue() );

    if( ram == NULL ) {
        as511_read_ram_free( td, ram );
        Nan::ThrowTypeError("Failed reading ram");
        return;
    }

    v8::Local<v8::Object> buf = Nan::NewBuffer(ram->laenge).ToLocalChecked();
    memcpy(node::Buffer::Data(buf), ram->ptr, ram->laenge);

    as511_read_ram_free( td, ram );
    info.GetReturnValue().Set(buf);
}

NAN_METHOD(Method_WriteSync) {
    if (td == NULL) {
        Nan::ThrowTypeError("Not Open");
        return;
    }

    if (info.Length() < 3) {
        Nan::ThrowTypeError("Wrong number of arguments");
        return;
    }

    if (!info[0]->IsNumber() || !info[1]->IsNumber()) {
        Nan::ThrowTypeError("Wrong arguments");
        return;
    }

    unsigned char *bufferPtr = (unsigned char*) node::Buffer::Data(info[2]->ToObject());
    as511_write_ram(td, (word_t)info[0]->NumberValue(), (word_t)info[1]->NumberValue(), bufferPtr);

    info.GetReturnValue().Set(true);
}

void init(v8::Local<v8::Object> target) {
    target->Set(Nan::New("openSync").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_OpenSync)->GetFunction());
    target->Set(Nan::New("closeSync").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_CloseSync)->GetFunction());
    target->Set(Nan::New("readSync").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_ReadSync)->GetFunction());
    target->Set(Nan::New("writeSync").ToLocalChecked(),Nan::New<v8::FunctionTemplate>(Method_WriteSync)->GetFunction());
}

NODE_MODULE(binding, init);
