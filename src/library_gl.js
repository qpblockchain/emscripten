/*
 * GL support. See https://github.com/kripken/emscripten/wiki/OpenGL-support
 * for current status.
 */

var LibraryGL = {
  $GL: {
#if GL_DEBUG
    debug: true,
#endif

    counter: 1,
    buffers: {},
    programs: {},
    framebuffers: {},
    renderbuffers: {},
    textures: {},
    uniforms: {},
    shaders: {},

    packAlignment: 4,   // default alignment is 4 bytes
    unpackAlignment: 4, // default alignment is 4 bytes

    // Linear lookup in one of the tables (buffers, programs, etc.). TODO: consider using a weakmap to make this faster, if it matters
    scan: function(table, object) {
      for (var item in table) {
        if (table[item] == object) return item;
      }
      return 0;
    },

    // Find a token in a shader source string
    findToken: function(source, token) {
      function isIdentChar(ch) {
        if (ch >= 48 && ch <= 57) // 0-9
          return true;
        if (ch >= 65 && ch <= 90) // A-Z
          return true;
        if (ch >= 97 && ch <= 122) // a-z
          return true;
        return false;
      }
      var i = -1;
      do {
        i = source.indexOf(token, i + 1);
        if (i < 0) {
          break;
        }
        if (i > 0 && isIdentChar(source[i - 1])) {
          continue;
        }
        i += token.length;
        if (i < source.length - 1 && isIdentChar(source[i + 1])) {
          continue;
        }
        return true;
      } while (true);
      return false;
    },

    getSource: function(shader, count, string, length) {
      var source = '';
      for (var i = 0; i < count; ++i) {
        var frag;
        if (length) {
          var len = {{{ makeGetValue('length', 'i*4', 'i32') }}};
          if (len < 0) {
            frag = Pointer_stringify({{{ makeGetValue('string', 'i*4', 'i32') }}});
          } else {
            frag = Pointer_stringify({{{ makeGetValue('string', 'i*4', 'i32') }}}, len);
          }
        } else {
          frag = Pointer_stringify({{{ makeGetValue('string', 'i*4', 'i32') }}});
        }
        source += frag;
      }
      // Let's see if we need to enable the standard derivatives extension
      type = Module.ctx.getShaderParameter(GL.shaders[shader], 0x8B4F /* GL_SHADER_TYPE */);
      if (type == 0x8B30 /* GL_FRAGMENT_SHADER */) {
        if (GL.findToken(source, "dFdx") ||
            GL.findToken(source, "dFdy") ||
            GL.findToken(source, "fwidth")) {
          source = "#extension GL_OES_standard_derivatives : enable\n" + source;
          var extension = Module.ctx.getExtension("OES_standard_derivatives");
#if GL_DEBUG
          if (!extension) {
            Module.printErr("Shader attempts to use the standard derivatives extension which is not available.");
          }
#endif
        }
      }
      return source;
    },

    computeImageSize: function(width, height, sizePerPixel, alignment) {
      function roundedToNextMultipleOf(x, y) {
        return Math.floor((x + y - 1) / y) * y
      }
      var plainRowSize = width * sizePerPixel;
      var alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
      return (height <= 0) ? 0 :
               ((height - 1) * alignedRowSize + plainRowSize);
    }
  },

  glPixelStorei: function(pname, param) {
    if (pname == 0x0D05 /* GL_PACK_ALIGNMENT */) {
      GL.packAlignment = param;
    } else if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
      GL.unpackAlignment = param;
    }
    Module.ctx.pixelStorei(pname, param);
  },

  glGetString: function(name_) {
    switch(name_) {
      case 0x1F00 /* GL_VENDOR */:
      case 0x1F01 /* GL_RENDERER */:
      case 0x1F02 /* GL_VERSION */:
        return allocate(intArrayFromString(Module.ctx.getParameter(name_)), 'i8', ALLOC_NORMAL);
      case 0x1F03 /* GL_EXTENSIONS */:
        return allocate(intArrayFromString(Module.ctx.getSupportedExtensions().join(' ')), 'i8', ALLOC_NORMAL);
      case 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */:
        return allocate(intArrayFromString('OpenGL ES GLSL 1.00 (WebGL)'), 'i8', ALLOC_NORMAL);
      default:
        throw 'Failure: Invalid glGetString value: ' + name_;
    }
  },

  glGetIntegerv: function(name_, p) {
    var result = Module.ctx.getParameter(name_);
    switch (typeof(result)) {
      case "number":
        {{{ makeSetValue('p', '0', 'result', 'i32') }}};
        break;
      case "boolean":
        {{{ makeSetValue('p', '0', 'result ? 1 : 0', 'i8') }}};
        break;
      case "string":
        throw 'Native code calling glGetIntegerv(' + name_ + ') on a name which returns a string!';
      case "object":
        if (result === null) {
          {{{ makeSetValue('p', '0', '0', 'i32') }}};
        } else if (result instanceof Float32Array ||
                   result instanceof Uint32Array ||
                   result instanceof Int32Array ||
                   result instanceof Array) {
          for (var i = 0; i < result.length; ++i) {
            {{{ makeSetValue('p', 'i*4', 'result[i]', 'i32') }}};
          }
        } else if (result instanceof WebGLBuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.buffers, result)', 'i32') }}};
        } else if (result instanceof WebGLProgram) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.programs, result)', 'i32') }}};
        } else if (result instanceof WebGLFramebuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.framebuffers, result)', 'i32') }}};
        } else if (result instanceof WebGLRenderbuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.renderbuffers, result)', 'i32') }}};
        } else if (result instanceof WebGLTexture) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.textures, result)', 'i32') }}};
        } else {
          throw 'Unknown object returned from WebGL getParameter';
        }
        break;
      case "undefined":
        throw 'Native code calling glGetIntegerv(' + name_ + ') and it returns undefined';
      default:
        throw 'Why did we hit the default case?';
    }
  },

  glGetFloatv: function(name_, p) {
    var result = Module.ctx.getParameter(name_);
    switch (typeof(result)) {
      case "number":
        {{{ makeSetValue('p', '0', 'result', 'float') }}};
        break;
      case "boolean":
        {{{ makeSetValue('p', '0', 'result ? 1.0 : 0.0', 'float') }}};
        break;
      case "string":
          {{{ makeSetValue('p', '0', '0', 'float') }}};
      case "object":
        if (result === null) {
          throw 'Native code calling glGetFloatv(' + name_ + ') and it returns null';
        } else if (result instanceof Float32Array ||
                   result instanceof Uint32Array ||
                   result instanceof Int32Array ||
                   result instanceof Array) {
          for (var i = 0; i < result.length; ++i) {
            {{{ makeSetValue('p', 'i*4', 'result[i]', 'float') }}};
          }
        } else if (result instanceof WebGLBuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.buffers, result)', 'float') }}};
        } else if (result instanceof WebGLProgram) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.programs, result)', 'float') }}};
        } else if (result instanceof WebGLFramebuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.framebuffers, result)', 'float') }}};
        } else if (result instanceof WebGLRenderbuffer) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.renderbuffers, result)', 'float') }}};
        } else if (result instanceof WebGLTexture) {
          {{{ makeSetValue('p', '0', 'GL.scan(GL.textures, result)', 'float') }}};
        } else {
          throw 'Unknown object returned from WebGL getParameter';
        }
        break;
      case "undefined":
        throw 'Native code calling glGetFloatv(' + name_ + ') and it returns undefined';
      default:
        throw 'Why did we hit the default case?';
    }
  },

  glGetBooleanv: function(name_, p) {
    var result = Module.ctx.getParameter(name_);
    switch (typeof(result)) {
      case "number":
        {{{ makeSetValue('p', '0', 'result != 0', 'i8') }}};
        break;
      case "boolean":
        {{{ makeSetValue('p', '0', 'result != 0', 'i8') }}};
        break;
      case "string":
        throw 'Native code calling glGetBooleanv(' + name_ + ') on a name which returns a string!';
      case "object":
        if (result === null) {
          {{{ makeSetValue('p', '0', '0', 'i8') }}};
        } else if (result instanceof Float32Array ||
                   result instanceof Uint32Array ||
                   result instanceof Int32Array ||
                   result instanceof Array) {
          for (var i = 0; i < result.length; ++i) {
            {{{ makeSetValue('p', 'i', 'result[i] != 0', 'i8') }}};
          }
        } else if (result instanceof WebGLBuffer ||
                   result instanceof WebGLProgram ||
                   result instanceof WebGLFramebuffer ||
                   result instanceof WebGLRenderbuffer ||
                   result instanceof WebGLTexture) {
          {{{ makeSetValue('p', '0', '1', 'i8') }}}; // non-zero ID is always 1!
        } else {
          throw 'Unknown object returned from WebGL getParameter';
        }
        break;
      case "undefined":
          throw 'Unknown object returned from WebGL getParameter';
      default:
        throw 'Why did we hit the default case?';
    }
  },

  glGenTextures: function(n, textures) {
    for (var i = 0; i < n; i++) {
      var id = GL.counter++;
      GL.textures[id] = Module.ctx.createTexture();
      {{{ makeSetValue('textures', 'i*4', 'id', 'i32') }}};
    }
  },

  glDeleteTextures: function(n, textures) {
    for (var i = 0; i < n; i++) {
      var id = {{{ makeGetValue('textures', 'i*4', 'i32') }}};
      Module.ctx.deleteTexture(GL.textures[id]);
      GL.textures[id] = null;
    }
  },

  glCompressedTexImage2D: function(target, level, internalformat, width, height, border, imageSize, data) {
    if (data) {
      data = {{{ makeHEAPView('U8', 'data', 'data+imageSize') }}};
    } else {
      data = null;
    }
    Module.ctx.compressedTexImage2D(target, level, internalformat, width, height, border, data);
  },

  glCompressedTexSubImage2D: function(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
    if (data) {
      data = {{{ makeHEAPView('U8', 'data', 'data+imageSize') }}};
    } else {
      data = null;
    }
    Module.ctx.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, data);
  },

  glTexImage2D: function(target, level, internalformat, width, height, border, format, type, pixels) {
    if (pixels) {
      var sizePerPixel;
      switch (type) {
        case 0x1401 /* GL_UNSIGNED_BYTE */:
          switch (format) {
            case 0x1906 /* GL_ALPHA */:
            case 0x1909 /* GL_LUMINANCE */:
              sizePerPixel = 1;
              break;
            case 0x1907 /* GL_RGB */:
              sizePerPixel = 3;
              break;
            case 0x1908 /* GL_RGBA */:
              sizePerPixel = 4;
              break;
            case 0x190A /* GL_LUMINANCE_ALPHA */:
              sizePerPixel = 2;
              break;
            default:
              throw 'Invalid format (' + format + ') passed to glTexImage2D';
          }
          break;
        case 0x8363 /* GL_UNSIGNED_SHORT_5_6_5 */:
        case 0x8033 /* GL_UNSIGNED_SHORT_4_4_4_4 */:
        case 0x8034 /* GL_UNSIGNED_SHORT_5_5_5_1 */:
          sizePerPixel = 2;
          break;
        default:
          throw 'Invalid type (' + type + ') passed to glTexImage2D';
      }
      var bytes = GL.computeImageSize(width, height, sizePerPixel, GL.unpackAlignment);
      pixels = {{{ makeHEAPView('U8', 'pixels', 'pixels+bytes') }}};
    } else {
      pixels = null;
    }
    Module.ctx.texImage2D(target, level, internalformat, width, height, border, format, type, pixels);
  },

  glTexSubImage2D: function(target, level, xoffset, yoffset, width, height, format, type, pixels) {
    if (pixels) {
      var sizePerPixel;
      switch (type) {
        case 0x1401 /* GL_UNSIGNED_BYTE */:
          switch (format) {
            case 0x1906 /* GL_ALPHA */:
            case 0x1909 /* GL_LUMINANCE */:
              sizePerPixel = 1;
              break;
            case 0x1907 /* GL_RGB */:
              sizePerPixel = 3;
              break;
            case 0x1908 /* GL_RGBA */:
              sizePerPixel = 4;
              break;
            case 0x190A /* GL_LUMINANCE_ALPHA */:
              sizePerPixel = 2;
              break;
            default:
              throw 'Invalid format (' + format + ') passed to glTexSubImage2D';
          }
          break;
        case 0x8363 /* GL_UNSIGNED_SHORT_5_6_5 */:
        case 0x8033 /* GL_UNSIGNED_SHORT_4_4_4_4 */:
        case 0x8034 /* GL_UNSIGNED_SHORT_5_5_5_1 */:
          sizePerPixel = 2;
          break;
        default:
          throw 'Invalid type (' + type + ') passed to glTexSubImage2D';
      }
      var bytes = GL.computeImageSize(width, height, sizePerPixel, GL.unpackAlignment);
      pixels = {{{ makeHEAPView('U8', 'pixels', 'pixels+bytes') }}};
    } else {
      pixels = null;
    }
    Module.ctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
  },

  glReadPixels: function(x, y, width, height, format, type, pixels) {
    Module.ctx.readPixels(x, y, width, height, format, type, HEAPU8.subarray(pixels));
  },

  glBindTexture: function(target, texture) {
    Module.ctx.bindTexture(target, GL.textures[texture]);
  },

  glGetTexParameterfv: function(target, pname, params) {
    {{{ makeSetValue('params', '0', 'Module.getTexParameter(target, pname)', 'float') }}};
  },

  glGetTexParameteriv: function(target, pname, params) {
    {{{ makeSetValue('params', '0', 'Module.getTexParameter(target, pname)', 'i32') }}};
  },

  glIsTexture: function(texture) {
    var fb = GL.textures[texture];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isTexture(fb);
  },

  glGenBuffers: function(n, buffers) {
    for (var i = 0; i < n; i++) {
      var id = GL.counter++;
      GL.buffers[id] = Module.ctx.createBuffer();
      {{{ makeSetValue('buffers', 'i*4', 'id', 'i32') }}};
    }
  },

  glDeleteBuffers: function(n, buffers) {
    for (var i = 0; i < n; i++) {
      var id = {{{ makeGetValue('buffers', 'i*4', 'i32') }}};
      Module.ctx.deleteBuffer(GL.buffers[id]);
      GL.buffers[id] = null;
    }
  },

  glGetBufferParameteriv: function(target, value, data) {
    {{{ makeSetValue('data', '0', 'Module.ctx.getBufferParameter(target, value)', 'i32') }}};
  },

  glBufferData: function(target, size, data, usage) {
    Module.ctx.bufferData(target, HEAPU8.subarray(data, data+size), usage);
  },

  glBufferSubData: function(target, offset, size, data) {
    var floatArray = {{{ makeHEAPView('F32', 'data', 'data+size') }}};
    Module.ctx.bufferSubData(target, offset, floatArray);
  },

  glIsBuffer: function(buffer) {
    var fb = GL.buffers[buffer];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isBuffer(fb);
  },

  glGenRenderbuffers: function(n, renderbuffers) {
    for (var i = 0; i < n; i++) {
      var id = GL.counter++;
      GL.renderbuffers[id] = Module.ctx.createRenderbuffer();
      {{{ makeSetValue('renderbuffers', 'i*4', 'id', 'i32') }}};
    }
  },

  glDeleteRenderbuffers: function(n, renderbuffers) {
    for (var i = 0; i < n; i++) {
      var id = {{{ makeGetValue('renderbuffers', 'i*4', 'i32') }}};
      Module.ctx.deleteRenderbuffer(GL.renderbuffers[id]);
      GL.renderbuffers[id];
    }
  },

  glBindRenderbuffer: function(target, renderbuffer) {
    Module.ctx.bindRenderbuffer(target, GL.renderbuffers[renderbuffer]);
  },

  glGetRenderbufferParameteriv: function(target, pname, params) {
    {{{ makeSetValue('params', '0', 'Module.ctx.getRenderbufferParameter(target, pname)', 'i32') }}};
  },

  glIsRenderbuffer: function(renderbuffer) {
    var fb = GL.renderbuffers[renderbuffer];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isRenderbuffer(fb);
  },

  glGetUniformfv: function(program, location, params) {
    var data = Module.ctx.getUniform(GL.programs[program], GL.uniforms[location]);
    if (typeof data == 'number') {
      {{{ makeSetValue('params', '0', 'data', 'float') }}};
    } else {
      for (var i = 0; i < data.length; i++) {
        {{{ makeSetValue('params', 'i', 'data[i]', 'float') }}};
      }
    }
  },

  glGetUniformiv: function(program, location, params) {
    var data = Module.ctx.getUniform(GL.programs[program], GL.uniforms[location]);
    if (typeof data == 'number' || typeof data == 'boolean') {
      {{{ makeSetValue('params', '0', 'data', 'i32') }}};
    } else {
      for (var i = 0; i < data.length; i++) {
        {{{ makeSetValue('params', 'i', 'data[i]', 'i32') }}};
      }
    }
  },

  glGetUniformLocation: function(program, name) {
    name = Pointer_stringify(name);
    var loc = Module.ctx.getUniformLocation(GL.programs[program], name);
    if (!loc) return -1;
    var id = GL.counter++;
    GL.uniforms[id] = loc;
    return id;
  },

  glGetVertexAttribfv: function(index, pname, params) {
    var data = Module.ctx.getVertexAttrib(index, pname);
    if (typeof data == 'number') {
      {{{ makeSetValue('params', '0', 'data', 'float') }}};
    } else {
      for (var i = 0; i < data.length; i++) {
        {{{ makeSetValue('params', 'i', 'data[i]', 'float') }}};
      }
    }
  },

  glGetVertexAttribiv: function(index, pname, params) {
    var data = Module.ctx.getVertexAttrib(index, pname);
    if (typeof data == 'number' || typeof data == 'boolean') {
      {{{ makeSetValue('params', '0', 'data', 'i32') }}};
    } else {
      for (var i = 0; i < data.length; i++) {
        {{{ makeSetValue('params', 'i', 'data[i]', 'i32') }}};
      }
    }
  },

  glGetVertexAttribPointerv: function(index, pname, pointer) {
    {{{ makeSetValue('pointer', '0', 'Module.ctx.getVertexAttribOffset(index, pname)', 'i32') }}};
  },

  glGetActiveUniform: function(program, index, bufSize, length, size, type, name) {
    program = GL.programs[program];
    var info = Module.ctx.getActiveUniform(program, index);

    var infoname = info.name.slice(0, bufSize - 1);
    writeStringToMemory(infoname, name);

    if (length) {
      {{{ makeSetValue('length', '0', 'infoname.length', 'i32') }}};
    }
    if (size) {
      {{{ makeSetValue('size', '0', 'info.size', 'i32') }}};
    }
    if (type) {
      {{{ makeSetValue('type', '0', 'info.type', 'i32') }}};
    }
  },

  glUniform1f: function(location, v0) {
    location = GL.uniforms[location];
    Module.ctx.uniform1f(location, v0);
  },

  glUniform2f: function(location, v0, v1) {
    location = GL.uniforms[location];
    Module.ctx.uniform2f(location, v0, v1);
  },

  glUniform3f: function(location, v0, v1, v2) {
    location = GL.uniforms[location];
    Module.ctx.uniform3f(location, v0, v1, v2);
  },

  glUniform4f: function(location, v0, v1, v2, v3) {
    location = GL.uniforms[location];
    Module.ctx.uniform4f(location, v0, v1, v2, v3);
  },

  glUniform1i: function(location, v0) {
    location = GL.uniforms[location];
    Module.ctx.uniform1i(location, v0);
  },

  glUniform2i: function(location, v0, v1) {
    location = GL.uniforms[location];
    Module.ctx.uniform2i(location, v0, v1);
  },

  glUniform3i: function(location, v0, v1, v2) {
    location = GL.uniforms[location];
    Module.ctx.uniform3i(location, v0, v1, v2);
  },

  glUniform4i: function(location, v0, v1, v2, v3) {
    location = GL.uniforms[location];
    Module.ctx.uniform4i(location, v0, v1, v2, v3);
  },

  glUniform1iv: function(location, count, value) {
    location = GL.uniforms[location];
    value = {{{ makeHEAPView('32', 'value', 'value+count*4') }}};
    Module.ctx.uniform1iv(location, value);
  },

  glUniform2iv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 2;
    value = {{{ makeHEAPView('32', 'value', 'value+count*4') }}};
    Module.ctx.uniform2iv(location, value);
  },

  glUniform3iv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 3;
    value = {{{ makeHEAPView('32', 'value', 'value+count*4') }}};
    Module.ctx.uniform3iv(location, value);
  },

  glUniform4iv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 4;
    value = {{{ makeHEAPView('32', 'value', 'value+count*4') }}};
    Module.ctx.uniform4iv(location, value);
  },

  glUniform1fv: function(location, count, value) {
    location = GL.uniforms[location];
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniform1fv(location, value);
  },

  glUniform2fv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 2;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniform2fv(location, value);
  },

  glUniform3fv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 3;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniform3fv(location, value);
  },

  glUniform4fv: function(location, count, value) {
    location = GL.uniforms[location];
    count *= 4;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniform4fv(location, value);
  },

  glUniformMatrix2fv: function(location, count, transpose, value) {
    location = GL.uniforms[location];
    count *= 4;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniformMatrix2fv(location, transpose, value);
  },

  glUniformMatrix3fv: function(location, count, transpose, value) {
    location = GL.uniforms[location];
    count *= 9;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniformMatrix3fv(location, transpose, value);
  },

  glUniformMatrix4fv: function(location, count, transpose, value) {
    location = GL.uniforms[location];
    count *= 16;
    value = {{{ makeHEAPView('F32', 'value', 'value+count*4') }}};
    Module.ctx.uniformMatrix4fv(location, transpose, value);
  },

  glBindBuffer: function(target, buffer) {
    Module.ctx.bindBuffer(target, GL.buffers[buffer]);
  },

  glVertexAttrib1fv: function(index, v) {
    v = {{{ makeHEAPView('F32', 'v', 'v+1*4') }}};
    Module.ctx.vertexAttrib1fv(index, v);
  },

  glVertexAttrib2fv: function(index, v) {
    v = {{{ makeHEAPView('F32', 'v', 'v+2*4') }}};
    Module.ctx.vertexAttrib2fv(index, v);
  },

  glVertexAttrib3fv: function(index, v) {
    v = {{{ makeHEAPView('F32', 'v', 'v+3*4') }}};
    Module.ctx.vertexAttrib3fv(index, v);
  },

  glVertexAttrib4fv: function(index, v) {
    v = {{{ makeHEAPView('F32', 'v', 'v+4*4') }}};
    Module.ctx.vertexAttrib4fv(index, v);
  },

  glGetAttribLocation: function(program, name) {
    program = GL.programs[program];
    name = Pointer_stringify(name);
    return Module.ctx.getAttribLocation(program, name);
  },

  glGetActiveAttrib: function(program, index, bufSize, length, size, type, name) {
    program = GL.programs[program];
    var info = Module.ctx.getActiveAttrib(program, index);

    var infoname = info.name.slice(0, bufSize - 1);
    writeStringToMemory(infoname, name);

    if (length) {
      {{{ makeSetValue('length', '0', 'infoname.length', 'i32') }}};
    }
    if (size) {
      {{{ makeSetValue('size', '0', 'info.size', 'i32') }}};
    }
    if (type) {
      {{{ makeSetValue('type', '0', 'info.type', 'i32') }}};
    }
  },

  glCreateShader: function(shaderType) {
    var id = GL.counter++;
    GL.shaders[id] = Module.ctx.createShader(shaderType);
    return id;
  },

  glDeleteShader: function(shader) {
    Module.ctx.deleteShader(GL.shaders[shader]);
    GL.shaders[shader] = null;
  },

  glDetachShader: function(program, shader) {
    Module.ctx.detachShader(GL.programs[program],
                            GL.shaders[shader]);
  },

  glGetAttachedShaders: function(program, maxCount, count, shaders) {
    var result = Module.ctx.getAttachedShaders(GL.programs[program]);
    var len = result.length;
    if (len > maxCount) {
      len = maxCount;
    }
    {{{ makeSetValue('count', '0', 'len', 'i32') }}};
    for (var i = 0; i < len; ++i) {
      {{{ makeSetValue('shaders', 'i*4', 'GL.shaders[result[i]]', 'i32') }}};
    }
  },

  glShaderSource: function(shader, count, string, length) {
    var source = GL.getSource(shader, count, string, length);
    Module.ctx.shaderSource(GL.shaders[shader], source);
  },

  glGetShaderSource: function(shader, bufSize, length, source) {
    var result = Module.ctx.getShaderSource(GL.shaders[shader]);
    result.slice(0, bufSize - 1);
    writeStringToMemory(result, source);
    if (length) {
      {{{ makeSetValue('length', '0', 'result.length', 'i32') }}};
    }
  },

  glCompileShader: function(shader) {
    Module.ctx.compileShader(GL.shaders[shader]);
  },

  glGetShaderInfoLog: function(shader, maxLength, length, infoLog) {
    var log = Module.ctx.getShaderInfoLog(GL.shaders[shader]);
    // Work around a bug in Chromium which causes getShaderInfoLog to return null
    if (!log) {
      log = "";
    }
    log = log.substr(0, maxLength - 1);
    writeStringToMemory(log, infoLog);
    if (length) {
      {{{ makeSetValue('length', '0', 'log.length', 'i32') }}}
    }
  },

  glGetShaderiv : function(shader, pname, p) {
    if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
      {{{ makeSetValue('p', '0', 'Module.ctx.getShaderInfoLog(GL.shaders[shader]).length + 1', 'i32') }}};
    } else {
      {{{ makeSetValue('p', '0', 'Module.ctx.getShaderParameter(GL.shaders[shader], pname)', 'i32') }}};
    }
  },

  glGetProgramiv : function(program, pname, p) {
    if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
      {{{ makeSetValue('p', '0', 'Module.ctx.getProgramInfoLog(GL.programs[program]).length + 1', 'i32') }}};
    } else {
      {{{ makeSetValue('p', '0', 'Module.ctx.getProgramParameter(GL.programs[program], pname)', 'i32') }}};
    }
  },

  glIsShader: function(shader) {
    var fb = GL.shaders[shader];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isShader(fb);
  },

  glCreateProgram: function() {
    var id = GL.counter++;
    GL.programs[id] = Module.ctx.createProgram();
    return id;
  },

  glDeleteProgram: function(program) {
    Module.ctx.deleteProgram(GL.programs[program]);
    GL.programs[program] = null;
  },

  glAttachShader: function(program, shader) {
    Module.ctx.attachShader(GL.programs[program],
                            GL.shaders[shader]);
  },

  glGetShaderPrecisionFormat: function(shaderType, precisionType, range, precision) {
    var result = Module.ctx.getShaderPrecisionFormat(shaderType, precisionType);
    {{{ makeSetValue('range', '0', 'result.rangeMin', 'i32') }}};
    {{{ makeSetValue('range', '4', 'result.rangeMax', 'i32') }}};
    {{{ makeSetValue('precision', '0', 'result.precision', 'i32') }}};
  },

  glLinkProgram: function(program) {
    Module.ctx.linkProgram(GL.programs[program]);
  },

  glGetProgramInfoLog: function(program, maxLength, length, infoLog) {
    var log = Module.ctx.getProgramInfoLog(GL.programs[program]);
    // Work around a bug in Chromium which causes getProgramInfoLog to return null
    if (!log) {
      log = "";
    }
    log = log.substr(0, maxLength - 1);
    writeStringToMemory(log, infoLog);
    if (length) {
      {{{ makeSetValue('length', '0', 'log.length', 'i32') }}}
    }
  },

  glUseProgram: function(program) {
    Module.ctx.useProgram(GL.programs[program]);
  },

  glValidateProgram: function(program) {
    Module.ctx.validateProgram(GL.programs[program]);
  },

  glIsProgram: function(program) {
    var fb = GL.programs[program];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isProgram(fb);
  },

  glBindAttribLocation: function(program, index, name) {
    name = Pointer_stringify(name);
    Module.ctx.bindAttribLocation(GL.programs[program], index, name);
  },

  glBindFramebuffer: function(target, framebuffer) {
    Module.ctx.bindFramebuffer(target, GL.framebuffers[framebuffer]);
  },

  glGenFramebuffers: function(n, ids) {
    for (var i = 0; i < n; ++i) {
      var id = GL.counter++;
      GL.framebuffers[id] = Module.ctx.createFramebuffer();
      {{{ makeSetValue('ids', 'i*4', 'id', 'i32') }}};
    }
  },

  glDeleteFramebuffers: function(n, framebuffers) {
    for (var i = 0; i < n; ++i) {
      var id = {{{ makeGetValue('framebuffers', 'i*4', 'i32') }}};
      Module.ctx.deleteFramebuffer(GL.framebuffers[id]);
      GL.framebuffers[id] = null;
    }
  },

  glFramebufferRenderbuffer: function(target, attachment, renderbuffertarget, renderbuffer) {
    Module.ctx.framebufferRenderbuffer(target, attachment, renderbuffertarget,
                                       GL.renderbuffers[renderbuffer]);
  },

  glFramebufferTexture2D: function(target, attachment, textarget, texture, level) {
    Module.ctx.framebufferTexture2D(target, attachment, textarget,
                                    GL.textures[texture], level);
  },

  glGetFramebufferAttachmentParameteriv: function(target, attachment, pname, params) {
    var result = Module.ctx.getFramebufferAttachmentParameter(target, attachment, pname);
    {{{ makeSetValue('params', '0', 'params', 'i32') }}};
  },

  glIsFramebuffer: function(framebuffer) {
    var fb = GL.framebuffers[framebuffer];
    if (typeof(fb) == 'undefined') {
      return 0;
    }
    return Module.ctx.isFramebuffer(fb);
  },

  // GL emulation: provides misc. functionality not present in OpenGL ES 2.0 or WebGL

  $GLEmulation__postset: 'GLEmulation.init();',
  $GLEmulation: {
    init: function() {
      // Add some emulation workarounds
      Module.printErr('WARNING: using emscripten GL emulation. This is a collection of limited workarounds, do not expect it to work');

      _glEnable = function(cap) {
        if (cap == 0x0DE1) return; // GL_TEXTURE_2D
        if (cap == 0x0B20) return; // GL_LINE_SMOOTH
        if (cap == 0x0B60) return; // GL_FOG
        Module.ctx.enable(cap);
      };

      _glDisable = function(cap) {
        if (cap == 0x0DE1) return; // GL_TEXTURE_2D
        if (cap == 0x0B20) return; // GL_LINE_SMOOTH
        if (cap == 0x0B60) return; // GL_FOG
        Module.ctx.disable(cap);
      };

      var glGetIntegerv = _glGetIntegerv;
      _glGetIntegerv = function(pname, params) {
        switch (pname) {
          case 0x84E2: pname = Module.ctx.MAX_TEXTURE_IMAGE_UNITS /* fake it */; break; // GL_MAX_TEXTURE_UNITS
          case 0x8B4A: { // GL_MAX_VERTEX_UNIFORM_COMPONENTS_ARB
            var result = Module.ctx.getParameter(Module.ctx.MAX_VERTEX_UNIFORM_VECTORS);
            {{{ makeSetValue('params', '0', 'result*4', 'i32') }}}; // GLES gives num of 4-element vectors, GL wants individual components, so multiply
            return;
          }
          case 0x8B49: { // GL_MAX_FRAGMENT_UNIFORM_COMPONENTS_ARB
            var result = Module.ctx.getParameter(Module.ctx.MAX_FRAGMENT_UNIFORM_VECTORS);
            {{{ makeSetValue('params', '0', 'result*4', 'i32') }}}; // GLES gives num of 4-element vectors, GL wants individual components, so multiply
            return;
          }
          case 0x8B4B: { // GL_MAX_VARYING_FLOATS_ARB
            var result = Module.ctx.getParameter(Module.ctx.MAX_VARYING_VECTORS);
            {{{ makeSetValue('params', '0', 'result*4', 'i32') }}}; // GLES gives num of 4-element vectors, GL wants individual components, so multiply
            return;
          }
          case 0x8871: pname = Module.ctx.MAX_COMBINED_TEXTURE_IMAGE_UNITS /* close enough */; break; // GL_MAX_TEXTURE_COORDS
        }
        glGetIntegerv(pname, params);
      };

      // Do some automatic rewriting to work around GLSL differences. Note that this must be done in
      // tandem with the rest of the program, by itself it cannot suffice.
      // Note that we need to remember shader types for this rewriting, saving sources makes it easier to debug.
      GL.shaderInfos = {};
#if GL_DEBUG
      GL.shaderSources = {};
      GL.shaderOriginalSources = {};
#endif
      var glCreateShader = _glCreateShader;
      _glCreateShader = function(shaderType) {
        var id = glCreateShader(shaderType);
        GL.shaderInfos[id] = {
          type: shaderType,
          ftransform: false
        };
        return id;
      };

      var glShaderSource = _glShaderSource;
      _glShaderSource = function(shader, count, string, length) {
        var source = GL.getSource(shader, count, string, length);
#if GL_DEBUG
        GL.shaderOriginalSources[shader] = source;
#endif
        if (GL.shaderInfos[shader].type == Module.ctx.VERTEX_SHADER) {
          // Replace ftransform() with explicit project/modelview transforms, and add position and matrix info.
          var has_pm = source.search(/u_projection/) >= 0;
          var has_mm = source.search(/u_modelView/) >= 0;
          var has_pv = source.search(/a_position/) >= 0;
          var need_pm = 0, need_mm = 0, need_pv = 0;
          var old = source;
          source = source.replace(/ftransform\(\)/g, '(u_projection * u_modelView * a_position)');
          if (old != source) need_pm = need_mm = need_pv = 1;
          old = source;
          source = source.replace(/gl_ProjectionMatrix/g, 'u_projection');
          if (old != source) need_pm = 1;
          old = source;
          source = source.replace(/gl_ModelViewMatrix/g, 'u_modelView');
          if (old != source) need_mm = 1;
          old = source;
          source = source.replace(/gl_Vertex/g, 'a_position');
          if (old != source) need_pv = 1;
          old = source;
          source = source.replace(/gl_ModelViewProjectionMatrix/g, '(u_modelView * u_projection)');
          if (old != source) need_pm = need_mm = 1;
          old = source;
          source = source.replace(/gl_ModelViewMatrixTranspose\[2\]/g, 'vec3(u_modelView[0][0], u_modelView[1][0], u_modelView[2][0])'); // XXX extremely inefficient
          if (old != source) need_mm = 1;
          if (need_pv && !has_pv) source = 'attribute vec4 a_position; \n' + source;
          if (need_mm && !has_mm) source = 'uniform mat4 u_modelView; \n' + source;
          if (need_pm && !has_pm) source = 'uniform mat4 u_projection; \n' + source;
          GL.shaderInfos[shader].ftransform = need_pm || need_mm || need_pv; // we will need to provide the fixed function stuff as attributes and uniforms
          for (var i = 0; i <= 6; i++) {
            // XXX To handle both regular texture mapping and cube mapping, we use vec4 for tex coordinates.
            var old = source;
            var need_vtc = source.search('v_texCoord' + i) == -1;
            source = source.replace(new RegExp('gl_TexCoord\\[' + i + '\\]', 'g'), 'v_texCoord' + i)
                           .replace(new RegExp('gl_MultiTexCoord' + i, 'g'), 'a_texCoord' + i);
            if (source != old) {
              source = 'attribute vec4 a_texCoord' + i + '; \n' + source;
              if (need_vtc) {
                source = 'varying vec4 v_texCoord' + i + ';   \n' + source;
              }
            }
          }
          if (source.indexOf('gl_FrontColor') >= 0) {
            source = 'varying vec4 v_color; \n' +
                     source.replace(/gl_FrontColor/g, 'v_color');
          }
          if (source.indexOf('gl_Color') >= 0) {
            source = 'attribute vec4 a_color; \n' +
                     'uniform vec4 u_color; \n' +
                     'uniform int u_hasColorAttrib; \n' +
                     source.replace(/gl_Color/g, '(u_hasColorAttrib > 0 ? a_color : u_color)');
          }
          if (source.indexOf('gl_Normal') >= 0) {
            source = 'attribute vec3 a_normal; \n' +
                     source.replace(/gl_Normal/g, 'a_normal');
          }
          if (source.indexOf('gl_FogFragCoord') >= 0) {
            source = 'varying float v_fogCoord;   \n' +
                     source.replace(/gl_FogFragCoord/g, 'v_fogCoord');
          }
        } else { // Fragment shader
          for (var i = 0; i <= 6; i++) {
            var old = source;
            source = source.replace(new RegExp('gl_TexCoord\\[' + i + '\\]', 'g'), 'v_texCoord' + i);
            if (source != old) {
              source = 'varying vec4 v_texCoord' + i + ';   \n' + source;
            }
          }
          if (source.indexOf('gl_Color') >= 0) {
            source = 'varying vec4 v_color; \n' + source.replace(/gl_Color/g, 'v_color');
          }
          source = source.replace(/gl_Fog.color/g, 'vec4(0.0)'); // XXX TODO
          source = 'precision mediump float;\n' + source;
        }
#if GL_DEBUG
        GL.shaderSources[shader] = source;
#endif
        Module.ctx.shaderSource(GL.shaders[shader], source);
      };

      var glCompileShader = _glCompileShader;
      _glCompileShader = function(shader) {
        Module.ctx.compileShader(GL.shaders[shader]);
        if (!Module.ctx.getShaderParameter(GL.shaders[shader], Module.ctx.COMPILE_STATUS)) {
          console.log('Failed to compile shader: ' + Module.ctx.getShaderInfoLog(GL.shaders[shader]));
          console.log('Info: ' + JSON.stringify(GL.shaderInfos[shader]));
#if GL_DEBUG
          console.log('Original source: ' + GL.shaderOriginalSources[shader]);
          console.log('Source: ' + GL.shaderSources[shader]);
          throw 'Shader compilation halt';
#else
          console.log('Enable GL_DEBUG to see shader source');
#endif
        }
      };

      GL.programShaders = {};
      var glAttachShader = _glAttachShader;
      _glAttachShader = function(program, shader) {
        if (!GL.programShaders[program]) GL.programShaders[program] = [];
        GL.programShaders[program].push(shader);
        glAttachShader(program, shader);
      };

      var glUseProgram = _glUseProgram;
      _glUseProgram = function(program) {
#if GL_DEBUG
        if (GL.debug) {
          console.log('[using program with shaders:]');
          GL.programShaders[program].forEach(function(shader) {
            console.log('  shader ' + shader + ', original source: ' + GL.shaderOriginalSources[shader]);
            console.log('         Source: ' + GL.shaderSources[shader]);
          });
        }
#endif
        GL.currProgram = program;
        glUseProgram(program);
      }

      var glDeleteProgram = _glDeleteProgram;
      _glDeleteProgram = function(program) {
        glDeleteProgram(program);
        if (program == GL.currProgram) GL.currProgram = 0;
      };

      var glBindBuffer = _glBindBuffer;
      _glBindBuffer = function(target, buffer) {
        glBindBuffer(target, buffer);
        if (target == Module.ctx.ARRAY_BUFFER) {
          GL.currArrayBuffer = buffer;
        } else if (target == Module.ctx.ELEMENT_ARRAY_BUFFER) {
          GL.currElementArrayBuffer = buffer;
        }
      };

      var glDeleteBuffers = _glDeleteBuffers;
      _glDeleteBuffers = function(n, buffers) {
        glDeleteBuffers(n, buffers);
        for (var i = 0; i < n; i++) {
          var buffer = {{{ makeGetValue('buffers', 'i*4', 'i32') }}};
          if (buffer == GL.currArrayBuffer) GL.currArrayBuffer = 0;
          if (buffer == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
        }
      };

      var glGetFloatv = _glGetFloatv;
      _glGetFloatv = function(pname, params) {
        if (pname == 0x0BA6) { // GL_MODELVIEW_MATRIX
          HEAPF32.set(GL.immediate.matrix['m'], params >> 2);
        } else if (pname == 0x0BA7) { // GL_PROJECTION_MATRIX
          HEAPF32.set(GL.immediate.matrix['p'], params >> 2);
        } else if (pname == 0x0BA8) { // GL_TEXTURE_MATRIX
          HEAPF32.set(GL.immediate.matrix['t'], params >> 2);
        } else if (pname == 0x0B66) { // GL_FOG_COLOR
          {{{ makeSetValue('params', '0', '0', 'float') }}};
        } else {
          glGetFloatv(pname, params);
        }
      };
    },

    getProcAddress: function(name) {
      name = name.replace('EXT', '').replace('ARB', '');
      // Do the translation carefully because of closure
      switch (name) {
        case 'glCreateShaderObject': case 'glCreateShader': func = _glCreateShader; break;
        case 'glCreateProgramObject': case 'glCreateProgram': func = _glCreateProgram; break;
        case 'glAttachObject': case 'glAttachShader': func = _glAttachShader; break;
        case 'glUseProgramObject': case 'glUseProgram': func = _glUseProgram; break;
        case 'glDeleteObject': func = function(id) {
          if (GL.programs[id]) {
            _glDeleteProgram(id);
          } else if (GL.shaders[id]) {
            _glDeleteShader(id);
          } else {
            console.log('WARNING: deleteObject received invalid id: ' + id);
          }
        }; break;
        case 'glGetObjectParameteriv': func = function(id, type, result) {
          if (GL.programs[id]) {
            if (type == 0x8B84) { // GL_OBJECT_INFO_LOG_LENGTH_ARB
              {{{ makeSetValue('result', '0', 'Module.ctx.getProgramInfoLog(GL.programs[id]).length', 'i32') }}};
              return;
            }
            _glGetProgramiv(id, type, result);
          } else if (GL.shaders[id]) {
            if (type == 0x8B84) { // GL_OBJECT_INFO_LOG_LENGTH_ARB
              {{{ makeSetValue('result', '0', 'Module.ctx.getShaderInfoLog(GL.shaders[id]).length', 'i32') }}};
              return;
            }
            _glGetShaderiv(id, type, result);
          } else {
            console.log('WARNING: getObjectParameteriv received invalid id: ' + id);
          }
        }; break;
        case 'glGetInfoLog': func = function(id, maxLength, length, infoLog) {
          if (GL.programs[id]) {
            _glGetProgramInfoLog(id, maxLength, length, infoLog);
          } else if (GL.shaders[id]) {
            _glGetShaderInfoLog(id, maxLength, length, infoLog);
          } else {
            console.log('WARNING: getObjectParameteriv received invalid id: ' + id);
          }
        }; break;
        case 'glBindProgram': func = function(type, id) {
          assert(id == 0);
        }; break;
        case 'glShaderSource': func = _glShaderSource; break;
        case 'glCompileShader': func = _glCompileShader; break;
        case 'glLinkProgram': func = _glLinkProgram; break;
        case 'glGetUniformLocation': func = _glGetUniformLocation; break;
        case 'glUniform1f': func = _glUniform1f; break;
        case 'glUniform2f': func = _glUniform2f; break;
        case 'glUniform3f': func = _glUniform3f; break;
        case 'glUniform4f': func = _glUniform4f; break;
        case 'glUniform1fv': func = _glUniform1fv; break;
        case 'glUniform2fv': func = _glUniform2fv; break;
        case 'glUniform3fv': func = _glUniform3fv; break;
        case 'glUniform4fv': func = _glUniform4fv; break;
        case 'glUniform1i': func = _glUniform1i; break;
        case 'glUniform2i': func = _glUniform2i; break;
        case 'glUniform3i': func = _glUniform3i; break;
        case 'glUniform4i': func = _glUniform4i; break;
        case 'glUniform1iv': func = _glUniform1iv; break;
        case 'glUniform2iv': func = _glUniform2iv; break;
        case 'glUniform3iv': func = _glUniform3iv; break;
        case 'glUniform4iv': func = _glUniform4iv; break;
        case 'glBindAttribLocation': func = _glBindAttribLocation; break;
        case 'glGetActiveUniform': func = _glGetActiveUniform; break;
        case 'glGenBuffers': func = _glGenBuffers; break;
        case 'glBindBuffer': func = _glBindBuffer; break;
        case 'glBufferData': func = _glBufferData; break;
        case 'glBufferSubData': func = _glBufferSubData; break;
        case 'glDeleteBuffers': func = _glDeleteBuffers; break;
        case 'glActiveTexture': func = _glActiveTexture; break;
        case 'glClientActiveTexture': func = _glClientActiveTexture; break;
        case 'glGetProgramiv': func = _glGetProgramiv; break;
        case 'glEnableVertexAttribArray': func = _glEnableVertexAttribArray; break;
        case 'glDisableVertexAttribArray': func = _glDisableVertexAttribArray; break;
        case 'glVertexAttribPointer': func = _glVertexAttribPointer; break;
        case 'glBindRenderbuffer': func = _glBindRenderbuffer; break;
        case 'glDeleteRenderbuffers': func = _glDeleteRenderbuffers; break;
        case 'glGenRenderbuffers': func = _glGenRenderbuffers; break;
        case 'glCompressedTexImage2D': func = _glCompressedTexImage2D; break;
        case 'glCompressedTexSubImage2D': func = _glCompressedTexSubImage2D; break;
        case 'glBindFramebuffer': func = _glBindFramebuffer; break;
        case 'glGenFramebuffers': func = _glGenFramebuffers; break;
        case 'glDeleteFramebuffers': func = _glDeleteFramebuffers; break;
        case 'glFramebufferRenderbuffer': func = _glFramebufferRenderbuffer; break;
        case 'glFramebufferTexture2D': func = _glFramebufferTexture2D; break;
        case 'glGetFramebufferAttachmentParameteriv': func = _glGetFramebufferAttachmentParameteriv; break;
        case 'glIsFramebuffer': func = _glIsFramebuffer; break;
        case 'glCheckFramebufferStatus': func = _glCheckFramebufferStatus; break;
        case 'glRenderbufferStorage': func = _glRenderbufferStorage; break;
        default: {
          console.log('WARNING: getProcAddress failed for ' + name);
          func = function() {
            console.log('WARNING: empty replacement for ' + name + ' called, no-op');
            return 0;
          };
        }
      }
      return Runtime.addFunction(func);
    }
  },

  // GL Immediate mode

  $GLImmediate__postset: 'Browser.moduleContextCreatedCallbacks.push(function() { GL.immediate.init() });',
  $GLImmediate: {
    // Vertex and index data
    maxElements: 10240,
    vertexData: null, // current vertex data. either tempData (glBegin etc.) or a view into the heap (gl*Pointer). Default view is F32
    vertexDataU8: null, // U8 view
    tempData: null,
    indexData: null,
    vertexCounter: 0,
    mode: 0,

    renderers: {},
    renderer: null,
    rendererComponents: {},

    // The following data structures are used for OpenGL Immediate Mode matrix routines.
    matrix: {},
    matrixStack: {},
    currentMatrix: 'm', // default is modelview
    tempMatrix: null,

    // Clientside attributes
    VERTEX: 0,
    NORMAL: 1,
    COLOR: 2,
    TEXTURE0: 3,
    TEXTURE1: 4,
    TEXTURE2: 5,
    TEXTURE3: 6,
    TEXTURE4: 7,
    TEXTURE5: 8,
    TEXTURE6: 9,
    NUM_ATTRIBUTES: 10,
    ATTRIBUTE_BY_NAME: {},

    totalEnabledClientAttributes: 0,
    enabledClientAttributes: [0, 0],
    clientAttributes: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
    clientActiveTexture: 0,
    clientColor: null,

    byteSizeByType: {
      0x1400: 1, // GL_BYTE
      0x1401: 1, // GL_UNSIGNED_BYTE
      0x1402: 2, // GL_SHORT
      0x1403: 2, // GL_UNSIGNED_SHORT
      0x1404: 4, // GL_INT
      0x1405: 4, // GL_UNSIGNED_INT
      0x1406: 4  // GL_FLOAT
    },

    setClientAttribute: function(name, size, type, stride, pointer) {
      var attrib = this.clientAttributes[GL.immediate.ATTRIBUTE_BY_NAME[name]];
      attrib.size = size;
      attrib.type = type;
      attrib.stride = stride;
      attrib.pointer = pointer;
      attrib.name = name + size;
    },

    // Renderers
    addRendererComponent: function(component) {
      if (this.rendererComponents[component]) return;
      this.rendererComponents[component] = 1;
      this.renderer += component;
    },

    setRenderer: function(renderer) {
      var name = renderer;
      if (GL.currProgram && renderer[0] != 'U') {
        name = 'UD' + GL.currProgram + '|' + renderer; // user-defined program renderer
      }
      this.renderer = name;
      if (this.renderers[name]) return this.renderers[name];
      this.renderers[name] = this.createRenderer(renderer);
      return this.renderers[name];
    },

    createRenderer: function(renderer) {
      var vertexSize = 0, positionSize = 0, positionOffset = 0, colorSize = 0, colorOffset = 0, normalSize = 0, normalOffset = 0;
      var textureSizes = [], textureOffsets = [], textureTypes = [], hasTextures = false;
      var which, size, index;
      for (var i = 0; i < renderer.length; i+=2) {
        var which = renderer[i];
        if (which == 'V') {
          size = parseInt(renderer[i+1]);
          positionSize = size;
          positionOffset = vertexSize;
          vertexSize += size * 4; // XXX assuming float
        } else if (which == 'T') {
          index = parseInt(renderer[i+1])
          size = parseInt(renderer[i+2]);
          i++;
          textureSizes[index] = size;
          textureOffsets[index] = vertexSize;
          if (renderer[i+2] == 's') { // special case: half-size texture
            i++;
            vertexSize += size * 2;
            textureTypes[index] = Module.ctx.SHORT;
          } else {
            vertexSize += size * 4;
            textureTypes[index] = Module.ctx.FLOAT;
          }
          hasTextures = true;
        } else if (which == 'N') {
          size = parseInt(renderer[i+1]);
          normalSize = size;
          normalOffset = vertexSize;
          vertexSize += 4; // 3 chars, + alignment
        } else if (which == 'C') {
          size = parseInt(renderer[i+1]);
          colorSize = size;
          colorOffset = vertexSize;
          vertexSize += 4; // Up to 4 chars, + alignment
        } else {
          console.log('Warning: Ignoring renderer attribute ' + which);
          size = parseInt(renderer[i+1]);
          vertexSize += size * 4; // XXX assuming float
        }
      }
      assert(positionSize > 0);
      // TODO: verify vertexSize is equal to the stride in enabled client arrays
      var useCurrProgram = !!GL.currProgram;
      var ret = {
        vertexSize: vertexSize,

        init: function() {
          if (useCurrProgram) {
            if (GL.shaderInfos[GL.programShaders[GL.currProgram][0]].type == Module.ctx.VERTEX_SHADER) {
              this.vertexShader = GL.shaders[GL.programShaders[GL.currProgram][0]];
              this.fragmentShader = GL.shaders[GL.programShaders[GL.currProgram][1]];
            } else {
              this.vertexShader = GL.shaders[GL.programShaders[GL.currProgram][1]];
              this.fragmentShader = GL.shaders[GL.programShaders[GL.currProgram][0]];
            }
            this.program = GL.programs[GL.currProgram];
          } else {
            this.vertexShader = Module.ctx.createShader(Module.ctx.VERTEX_SHADER);
            var zero = positionSize == 2 ? '0, ' : '';
            Module.ctx.shaderSource(this.vertexShader, 'attribute vec' + positionSize + ' a_position;  \n' +
                                                       'attribute vec2 a_texCoord0;  \n' +
                                                       (hasTextures ? 'varying vec2 v_texCoord;    \n' : '') +
                                                       'varying vec4 v_color; \n' +
                                                       (colorSize ? 'attribute vec4 a_color; \n': 'uniform vec4 u_color; \n') +
                                                       'uniform mat4 u_modelView;   \n' +
                                                       'uniform mat4 u_projection;  \n' +
                                                       'void main()                 \n' +
                                                       '{                           \n' +
                                                       '  gl_Position = u_projection * (u_modelView * vec4(a_position, ' + zero + '1.0)); \n' +
                                                       (hasTextures ? 'v_texCoord = a_texCoord0;    \n' : '') +
                                                       (colorSize ? 'v_color = a_color; \n' : 'v_color = u_color; \n') +
                                                       '}                           \n');
            Module.ctx.compileShader(this.vertexShader);

            this.fragmentShader = Module.ctx.createShader(Module.ctx.FRAGMENT_SHADER);
            Module.ctx.shaderSource(this.fragmentShader, 'precision mediump float;                            \n' +
                                                         'varying vec2 v_texCoord;                            \n' +
                                                         'uniform sampler2D u_texture;                        \n' +
                                                         'varying vec4 v_color;                               \n' +
                                                         'void main()                                         \n' +
                                                         '{                                                   \n' +
                                                         (hasTextures ? 'gl_FragColor = v_color * texture2D( u_texture, v_texCoord );\n' :
                                                                        'gl_FragColor = v_color;\n') +
                                                         '}                                                   \n');
            Module.ctx.compileShader(this.fragmentShader);

            this.program = Module.ctx.createProgram();
            Module.ctx.attachShader(this.program, this.vertexShader);
            Module.ctx.attachShader(this.program, this.fragmentShader);
            Module.ctx.linkProgram(this.program);
          }

          this.positionLocation = Module.ctx.getAttribLocation(this.program, 'a_position');
          this.texCoordLocations = [];
          for (var i = 0; i < textureSizes.length; i++) {
            if (textureSizes[i]) {
              this.texCoordLocations[i] = Module.ctx.getAttribLocation(this.program, 'a_texCoord' + i);
            }
          }
          this.colorLocation = Module.ctx.getAttribLocation(this.program, 'a_color');
          this.normalLocation = Module.ctx.getAttribLocation(this.program, 'a_normal');

          this.textureLocation = Module.ctx.getUniformLocation(this.program, 'u_texture'); // only for immediate mode with no shaders, so only one is enough
          this.modelViewLocation = Module.ctx.getUniformLocation(this.program, 'u_modelView');
          this.projectionLocation = Module.ctx.getUniformLocation(this.program, 'u_projection');
          this.hasColorAttribLocation = Module.ctx.getUniformLocation(this.program, 'u_hasColorAttrib');
          this.colorUniformLocation = Module.ctx.getUniformLocation(this.program, 'u_color');

          this.hasTextures = hasTextures;
          this.hasColorAttrib = colorSize > 0 && this.colorLocation >= 0;
          this.hasColorUniform = !!this.colorUniformLocation;
          this.hasNormal = this.normalLocation >= 0;

          this.floatType = Module.ctx.FLOAT; // minor optimization
        },

        prepare: function() {
          if (this.modelViewLocation) Module.ctx.uniformMatrix4fv(this.modelViewLocation, false, GL.immediate.matrix['m']);
          if (this.projectionLocation) Module.ctx.uniformMatrix4fv(this.projectionLocation, false, GL.immediate.matrix['p']);

          Module.ctx.vertexAttribPointer(this.positionLocation, positionSize, Module.ctx.FLOAT, false,
                                         vertexSize, positionOffset);
          Module.ctx.enableVertexAttribArray(this.positionLocation);
          if (this.hasTextures) {
            for (var i = 0; i < textureSizes.length; i++) {
              if (textureSizes[i] && this.texCoordLocations[i] >= 0) {
                Module.ctx.vertexAttribPointer(this.texCoordLocations[i], textureSizes[i], textureTypes[i], false,
                                               vertexSize, textureOffsets[i]);
                Module.ctx.enableVertexAttribArray(this.texCoordLocations[i]);
              }
            }
          }
          if (this.hasColorAttrib) {
            Module.ctx.vertexAttribPointer(this.colorLocation, colorSize, Module.ctx.UNSIGNED_BYTE, true,
                                           vertexSize, colorOffset);
            Module.ctx.enableVertexAttribArray(this.colorLocation);
            Module.ctx.uniform1i(this.hasColorAttribLocation, 1);
          } else if (this.hasColorUniform) {
            Module.ctx.uniform1i(this.hasColorAttribLocation, 0);
            Module.ctx.uniform4fv(this.colorUniformLocation, GL.immediate.clientColor);
          }
          if (this.hasNormal) {
            Module.ctx.vertexAttribPointer(this.normalLocation, normalSize, Module.ctx.BYTE, true,
                                           vertexSize, normalOffset);
            Module.ctx.enableVertexAttribArray(this.normalLocation);
          }
          if (!useCurrProgram) { // otherwise, the user program will set the sampler2D binding and uniform itself
            var texture = Module.ctx.getParameter(Module.ctx.TEXTURE_BINDING_2D);
            Module.ctx.activeTexture(Module.ctx.TEXTURE0);
            Module.ctx.bindTexture(Module.ctx.TEXTURE_2D, texture);
            Module.ctx.uniform1i(this.textureLocation, 0);
          }
        },

        cleanup: function() {
          Module.ctx.disableVertexAttribArray(this.positionLocation);
          if (this.hasTextures) {
            for (var i = 0; i < textureSizes.length; i++) {
              if (textureSizes[i] && this.texCoordLocations[i] >= 0) {
                Module.ctx.disableVertexAttribArray(this.texCoordLocations[i]);
              }
            }
          }
          if (this.hasColorAttrib) {
            Module.ctx.disableVertexAttribArray(this.colorLocation);
          }
          if (this.hasNormal) {
            Module.ctx.disableVertexAttribArray(this.normalLocation);
          }
        }
      };
      ret.init();
      return ret;
    },

    // Main functions
    initted: false,
    init: function() {
      Module.printErr('WARNING: using emscripten GL immediate mode emulation. This is very limited in what it supports');
      GL.immediate.initted = true;

      // No JSON notation for these objects, for closure w/js optimizer
      this.matrix['m'] = null; // modelview
      this.matrix['p'] = null; // projection
      this.matrix['t'] = null; // texture

      this.matrixStack['m'] = [];
      this.matrixStack['p'] = [];
      this.matrixStack['t'] = [];

      this.ATTRIBUTE_BY_NAME['V'] = 0;
      this.ATTRIBUTE_BY_NAME['N'] = 1;
      this.ATTRIBUTE_BY_NAME['C'] = 2;
      this.ATTRIBUTE_BY_NAME['T0'] = 3;
      this.ATTRIBUTE_BY_NAME['T1'] = 4;
      this.ATTRIBUTE_BY_NAME['T2'] = 5;
      this.ATTRIBUTE_BY_NAME['T3'] = 6;
      this.ATTRIBUTE_BY_NAME['T4'] = 7;
      this.ATTRIBUTE_BY_NAME['T5'] = 8;
      this.ATTRIBUTE_BY_NAME['T6'] = 9;

      // Initialize matrix library

      GL.immediate.matrix['m'] = GL.immediate.matrix.lib.mat4.create();
      GL.immediate.matrix['p'] = GL.immediate.matrix.lib.mat4.create();
      GL.immediate.matrix['t'] = GL.immediate.matrix.lib.mat4.create();
      GL.immediate.currentMatrix = GL.immediate.matrix.lib.mat4.create();

      // Buffers for data
      this.tempData = new Float32Array(this.maxElements);
      this.indexData = new Uint16Array(this.maxElements);

      this.vertexDataU8 = new Uint8Array(this.tempData.buffer);

      this.vertexObject = Module.ctx.createBuffer();
      Module.ctx.bindBuffer(Module.ctx.ARRAY_BUFFER, this.vertexObject);
      Module.ctx.bufferData(Module.ctx.ARRAY_BUFFER, this.maxElements*4, Module.ctx.DYNAMIC_DRAW);
      Module.ctx.bindBuffer(Module.ctx.ARRAY_BUFFER, null);

      this.indexObject = Module.ctx.createBuffer();
      Module.ctx.bindBuffer(Module.ctx.ELEMENT_ARRAY_BUFFER, this.indexObject);
      Module.ctx.bufferData(Module.ctx.ELEMENT_ARRAY_BUFFER, this.maxElements*2, Module.ctx.DYNAMIC_DRAW);
      Module.ctx.bindBuffer(Module.ctx.ELEMENT_ARRAY_BUFFER, null);

      this.clientColor = new Float32Array([1, 1, 1, 1]);

      // Replace some functions with immediate-mode aware versions
      _glDrawArrays = function(mode, first, count) {
        if (GL.immediate.totalEnabledClientAttributes == 0) {
          Module.ctx.drawArrays(mode, first, count);
          return;
        }
        var renderer = GL.immediate.prepareClientAttributes(count);
        GL.immediate.mode = mode;
        GL.immediate.setRenderer(renderer);
        GL.immediate.flush(null, first);
      };

      _glDrawElements = function(mode, count, type, indices) {
        if (GL.immediate.totalEnabledClientAttributes == 0) {
          Module.ctx.drawElements(mode, count, type, indices);
          return;
        }

        var renderer = GL.immediate.prepareClientAttributes(count);
        GL.immediate.mode = mode;
        GL.immediate.setRenderer(renderer);
        GL.immediate.flush(count, indices);
      };
    },

    tempClientAttributes: [],
    prepareClientAttributes: function(count) {
      // Client attributes are to be used here, emulate that
      var stride = 0, start;
      var attributes = GL.immediate.tempClientAttributes;
      attributes.length = 0;
      for (var i = 0; i < GL.immediate.NUM_ATTRIBUTES; i++) {
        if (GL.immediate.enabledClientAttributes[i]) attributes.push(GL.immediate.clientAttributes[i]);
      }
      attributes.sort(function(x, y) { return !x ? (!y ? 0 : 1) : (!y ? -1 : (x.pointer - y.pointer)) });
      start = attributes[0].pointer;
      for (var i = 0; i < attributes.length; i++) {
        var attribute = attributes[i];
        if (!attribute) break;
#if ASSERTIONS
        assert(attribute.stride);
        assert(stride == 0 || stride == attribute.stride); // must all be in the same buffer
#endif
        stride = attribute.stride;
      }

      var renderer = '', bytes = 0;
      for (var i = 0; i < attributes.length; i++) {
        var attribute = attributes[i];
        if (!attribute) break;
        attribute.offset = attribute.pointer - start;
        if (attribute.offset > bytes) { // ensure we start where we should
          assert((attribute.offset - bytes)%4 == 0); // XXX assuming 4-alignment
          renderer += '?' + ((attribute.offset - bytes)/4);
          bytes += attribute.offset - bytes;
        }
        renderer += attribute.name;
        bytes += attribute.size * GL.immediate.byteSizeByType[attribute.type];
        if (attribute.name[0] == 'T' && GL.immediate.byteSizeByType[attribute.type] == 2) {
          renderer += 's'; // special case, texture coords can be 4 *or* 2-size
        }
        if (bytes % 4 != 0) bytes += 4 - (bytes % 4); // XXX assuming 4-alignment
#if ASSERTIONS
        assert(0 <= attribute.offset && attribute.offset < stride); // must all be in the same buffer
#endif
      }

      assert(stride == 0 || bytes <= stride);

      if (bytes < stride) { // ensure the size is that of the stride
        assert((stride - bytes)%4 == 0); // assuming float
        renderer += '?' + ((stride-bytes)/4);
        bytes = stride;
      }

      bytes *= count;
      if (!GL.currArrayBuffer) {
        GL.immediate.vertexData = {{{ makeHEAPView('F32', 'start', 'start + bytes') }}}; // XXX assuming float
      }
      GL.immediate.vertexCounter = bytes / 4; // XXX assuming float

      return renderer;
    },

    flush: function(numProvidedIndexes, startIndex) {
      startIndex = startIndex || 0;

      var renderer = this.setRenderer(this.renderer);

      // Generate index data in a format suitable for GLES 2.0/WebGL
      var numVertexes = 4 * this.vertexCounter / renderer.vertexSize; // XXX assuming float
      assert(numVertexes % 1 == 0);

      var numIndexes = 0;
      if (numProvidedIndexes) {
        numIndexes = numProvidedIndexes;
      } else if (GL.immediate.mode > 6) { // above GL_TRIANGLE_FAN are the non-GL ES modes
        if (GL.immediate.mode == 7) { // GL_QUADS
          var numQuads = numVertexes / 4;
          assert(numQuads % 1 == 0);
          for (var i = 0; i < numQuads; i++) {
            var start = i*4;
            GL.immediate.indexData[numIndexes++] = start;
            GL.immediate.indexData[numIndexes++] = start+1;
            GL.immediate.indexData[numIndexes++] = start+2;
            GL.immediate.indexData[numIndexes++] = start;
            GL.immediate.indexData[numIndexes++] = start+2;
            GL.immediate.indexData[numIndexes++] = start+3;
          }
        } else {
          throw 'unsupported immediate mode ' + GL.immediate.mode;
        }
        assert(numIndexes < GL.immediate.maxElements, 'too many immediate mode indexes');

        Module.ctx.bindBuffer(Module.ctx.ELEMENT_ARRAY_BUFFER, this.indexObject);
        Module.ctx.bufferSubData(Module.ctx.ELEMENT_ARRAY_BUFFER, 0, this.indexData.subarray(0, numIndexes));
      }

      if (!GL.currArrayBuffer) {
        Module.ctx.bindBuffer(Module.ctx.ARRAY_BUFFER, this.vertexObject);
        Module.ctx.bufferSubData(Module.ctx.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.vertexCounter));
      }

      // Render
      if (!GL.currProgram) {
        Module.ctx.useProgram(renderer.program);
      }

      renderer.prepare();

      if (numIndexes) {
        if (!numProvidedIndexes) {
          Module.ctx.bindBuffer(Module.ctx.ELEMENT_ARRAY_BUFFER, this.indexObject);
        }
        Module.ctx.drawElements(Module.ctx.TRIANGLES, numIndexes, Module.ctx.UNSIGNED_SHORT, startIndex);
      } else {
        Module.ctx.drawArrays(GL.immediate.mode, startIndex, numVertexes);
      }

      renderer.cleanup();

      if (!GL.currArrayBuffer) {
        Module.ctx.bindBuffer(Module.ctx.ARRAY_BUFFER, null);
      }
      if (!GL.currProgram) {
        Module.ctx.useProgram(null);
      }

      this.mode = 0;
      this.vertexCounter = 0;
    }
  },

  $GLImmediateSetup__deps: ['$GLImmediate', function() { return 'GL.immediate = GLImmediate; GL.immediate.matrix.lib = ' + read('gl-matrix.js') + ';\n' }],
  $GLImmediateSetup: {},

  glBegin__deps: ['$GLImmediateSetup'],
  glBegin: function(mode) {
    GL.immediate.mode = mode;
    GL.immediate.renderer = '';
    GL.immediate.rendererComponents = {}; // XXX
    GL.immediate.vertexData = GL.immediate.tempData;
  },

  glEnd: function() {
    GL.immediate.flush();
  },

  glVertex3f: function(x, y, z) {
#if ASSERTIONS
    assert(GL.immediate.mode); // must be in begin/end
#endif
    GL.immediate.vertexData[GL.immediate.vertexCounter++] = x;
    GL.immediate.vertexData[GL.immediate.vertexCounter++] = y;
    GL.immediate.vertexData[GL.immediate.vertexCounter++] = z || 0;
#if ASSERTIONS
    assert(GL.immediate.vertexCounter < GL.immediate.maxElements);
#endif
    GL.immediate.addRendererComponent('V3');
  },
  glVertex2f: 'glVertex3f',

  glVertex3fv__deps: ['glVertex3f'],
  glVertex3fv: function(p) {
    _glVertex3f({{{ makeGetValue('p', '0', 'float') }}}, {{{ makeGetValue('p', '4', 'float') }}}, {{{ makeGetValue('p', '8', 'float') }}});
  },

  glTexCoord2i: function(u, v) {
#if ASSERTIONS
    assert(GL.immediate.mode); // must be in begin/end
#endif
    GL.immediate.vertexData[GL.immediate.vertexCounter++] = u;
    GL.immediate.vertexData[GL.immediate.vertexCounter++] = v;
    GL.immediate.addRendererComponent('T02');
  },
  glTexCoord2f: 'glTexCoord2i',

  glTexCoord2fv__deps: ['glTexCoord2f'],
  glTexCoord2fv: function(v) {
    _glTexCoord2f({{{ makeGetValue('v', '0', 'float') }}}, {{{ makeGetValue('v', '4', 'float') }}});
  },

  glColor4f: function(r, g, b, a) {
    // TODO: make ub the default, not f, save a few mathops
    if (GL.immediate.mode) {
      var start = GL.immediate.vertexCounter << 2;
      GL.immediate.vertexDataU8[start + 0] = r * 255;
      GL.immediate.vertexDataU8[start + 1] = g * 255;
      GL.immediate.vertexDataU8[start + 2] = b * 255;
      GL.immediate.vertexDataU8[start + 3] = a * 255;
      GL.immediate.vertexCounter++;
      GL.immediate.addRendererComponent('C4');
    } else {
      GL.immediate.clientColor[0] = r;
      GL.immediate.clientColor[1] = g;
      GL.immediate.clientColor[2] = b;
      GL.immediate.clientColor[3] = a;
    }
  },
  glColor4d: 'glColor4f',
  glColor4ub__deps: ['glColor4f'],
  glColor4ub: function(r, g, b, a) {
    _glColor4f((r&255)/255, (g&255)/255, (b&255)/255, (a&255)/255);
  },
  glColor4us__deps: ['glColor4f'],
  glColor4us: function(r, g, b, a) {
    _glColor4f((r&65525)/65535, (g&65525)/65535, (b&65525)/65535, (a&65525)/65535);
  },
  glColor4ui__deps: ['glColor4f'],
  glColor4ui: function(r, g, b, a) {
    _glColor4f((r>>>0)/4294967295, (g>>>0)/4294967295, (b>>>0)/4294967295, (a>>>0)/4294967295);
  },
  glColor3f__deps: ['glColor4f'],
  glColor3f: function(r, g, b) {
    _glColor4f(r, g, b, 1);
  },
  glColor3d: 'glColor3f',
  glColor3ub__deps: ['glColor4ub'],
  glColor3ub: function(r, g, b) {
    _glColor4ub(r, g, b, 255);
  },
  glColor3us__deps: ['glColor4us'],
  glColor3us: function(r, g, b) {
    _glColor4us(r, g, b, 65535);
  },
  glColor3ui__deps: ['glColor4ui'],
  glColor3ui: function(r, g, b) {
    _glColor4ui(r, g, b, 4294967295);
  },

  glColor3fv__deps: ['glColor3f'],
  glColor3fv: function(p) {
    _glColor3f({{{ makeGetValue('p', '0', 'float') }}}, {{{ makeGetValue('p', '4', 'float') }}}, {{{ makeGetValue('p', '8', 'float') }}});
  },
  glColor4fv__deps: ['glColor4f'],
  glColor4fv: function(p) {
    _glColor4f({{{ makeGetValue('p', '0', 'float') }}}, {{{ makeGetValue('p', '4', 'float') }}}, {{{ makeGetValue('p', '8', 'float') }}}, {{{ makeGetValue('p', '12', 'float') }}});
  },

  glFogf: function(){}, // TODO

  glPolygonMode: function(){}, // TODO

  // ClientState/gl*Pointer

  glEnableClientState: function(cap, disable) {
    switch(cap) {
      case 0x8078: // GL_TEXTURE_COORD_ARRAY
        GL.immediate.enabledClientAttributes[GL.immediate.TEXTURE0 + GL.immediate.clientActiveTexture] = !disable; break;
      case 0x8074: // GL_VERTEX_ARRAY
        GL.immediate.enabledClientAttributes[GL.immediate.VERTEX] = !disable; break;
      case 0x8075: // GL_NORMAL_ARRAY
        GL.immediate.enabledClientAttributes[GL.immediate.NORMAL] = !disable; break;
      case 0x8076: // GL_COLOR_ARRAY
        GL.immediate.enabledClientAttributes[GL.immediate.COLOR] = !disable; break;
      default:
        throw 'unhandled clientstate: ' + cap;
    }
    if (!disable) {
      GL.immediate.totalEnabledClientAttributes++;
    } else {
      GL.immediate.totalEnabledClientAttributes--;
    }
  },
  glDisableClientState: function(cap) {
    _glEnableClientState(cap, 1);
  },

  glVertexPointer__deps: ['$GLEmulation'], // if any pointers are used, glVertexPointer must be, and if it is, then we need emulation
  glVertexPointer: function(size, type, stride, pointer) {
    GL.immediate.setClientAttribute('V', size, type, stride, pointer);
  },
  glTexCoordPointer: function(size, type, stride, pointer) {
    GL.immediate.setClientAttribute('T' + GL.immediate.clientActiveTexture, size, type, stride, pointer);
  },
  glNormalPointer: function(type, stride, pointer) {
    GL.immediate.setClientAttribute('N', 3, type, stride, pointer);
  },
  glColorPointer: function(size, type, stride, pointer) {
    GL.immediate.setClientAttribute('C', size, type, stride, pointer);
  },

  glClientActiveTexture: function(texture) {
    GL.immediate.clientActiveTexture = texture - 0x84C0; // GL_TEXTURE0
  },

  // OpenGL Immediate Mode matrix routines.
  // Note that in the future we might make these available only in certain modes.
  glMatrixMode__deps: ['$GL', '$GLImmediateSetup', '$GLEmulation'], // emulation is not strictly needed, this is a workaround
  glMatrixMode: function(mode) {
    if (mode == 0x1700 /* GL_MODELVIEW */) {
      GL.immediate.currentMatrix = 'm';
    } else if (mode == 0x1701 /* GL_PROJECTION */) {
      GL.immediate.currentMatrix = 'p';
    } else if (mode == 0x1702) { // GL_TEXTURE
      GL.immediate.currentMatrix = 't';
    } else {
      throw "Wrong mode " + mode + " passed to glMatrixMode";
    }
  },

  glPushMatrix: function() {
    GL.immediate.matrixStack[GL.immediate.currentMatrix].push(
        Array.prototype.slice.call(GL.immediate.matrix[GL.immediate.currentMatrix]));
  },

  glPopMatrix: function() {
    GL.immediate.matrix[GL.immediate.currentMatrix] = GL.immediate.matrixStack[GL.immediate.currentMatrix].pop();
  },

  glLoadIdentity__deps: ['$GL', '$GLImmediateSetup'],
  glLoadIdentity: function() {
    GL.immediate.matrix.lib.mat4.identity(GL.immediate.matrix[GL.immediate.currentMatrix]);
  },

  glLoadMatrixd: function(matrix) {
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F64', 'matrix', 'matrix+16*8') }}}, GL.immediate.matrix[GL.immediate.currentMatrix]);
  },

  glLoadMatrixf: function(matrix) {
#if GL_DEBUG
    console.log('glLoadMatrixf receiving: ' + Array.prototype.slice.call(HEAPF32.subarray(matrix >> 2, (matrix >> 2) + 16)));
#endif
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F32', 'matrix', 'matrix+16*4') }}}, GL.immediate.matrix[GL.immediate.currentMatrix]);
  },

  glLoadTransposeMatrixd: function(matrix) {
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F64', 'matrix', 'matrix+16*8') }}}, GL.immediate.matrix[GL.immediate.currentMatrix]);
    GL.immediate.matrix.lib.mat4.transpose(GL.immediate.matrix[GL.immediate.currentMatrix]);
  },

  glLoadTransposeMatrixf: function(matrix) {
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F32', 'matrix', 'matrix+16*4') }}}, GL.immediate.matrix[GL.immediate.currentMatrix]);
    GL.immediate.matrix.lib.mat4.transpose(GL.immediate.matrix[GL.immediate.currentMatrix]);
  },

  glMultMatrixd: function(matrix) {
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix],
        {{{ makeHEAPView('F64', 'matrix', 'matrix+16*8') }}});
  },

  glMultMatrixf: function(matrix) {
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix],
        {{{ makeHEAPView('F32', 'matrix', 'matrix+16*4') }}});
  },

  glMultTransposeMatrixd: function(matrix) {
    var colMajor = GL.immediate.matrix.lib.mat4.create();
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F64', 'matrix', 'matrix+16*8') }}}, colMajor);
    GL.immediate.matrix.lib.mat4.transpose(colMajor);
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix], colMajor);
  },

  glMultTransposeMatrixf: function(matrix) {
    var colMajor = GL.immediate.matrix.lib.mat4.create();
    GL.immediate.matrix.lib.mat4.set({{{ makeHEAPView('F32', 'matrix', 'matrix+16*4') }}}, colMajor);
    GL.immediate.matrix.lib.mat4.transpose(colMajor);
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix], colMajor);
  },

  glFrustum: function(left, right, bottom, top_, nearVal, farVal) {
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix],
        GL.immediate.matrix.lib.mat4.frustum(left, right, bottom, top_, nearVal, farVal));
  },

  glOrtho: function(left, right, bottom, top_, nearVal, farVal) {
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix],
        GL.immediate.matrix.lib.mat4.ortho(left, right, bottom, top_, nearVal, farVal));
  },

  glScaled: function(x, y, z) {
    GL.immediate.matrix.lib.mat4.scale(GL.immediate.matrix[GL.immediate.currentMatrix], [x, y, z]);
  },
  glScalef: 'glScaled',

  glTranslated: function(x, y, z) {
    GL.immediate.matrix.lib.mat4.translate(GL.immediate.matrix[GL.immediate.currentMatrix], [x, y, z]);
  },
  glTranslatef: 'glTranslated',

  glRotated: function(angle, x, y, z) {
    GL.immediate.matrix.lib.mat4.rotate(GL.immediate.matrix[GL.immediate.currentMatrix], angle*Math.PI/180, [x, y, z]);
  },
  glRotatef: 'glRotated',

  // GLU

  gluPerspective: function(fov, aspect, near, far) {
    GL.immediate.matrix.lib.mat4.multiply(GL.immediate.matrix[GL.immediate.currentMatrix],
        GL.immediate.matrix.lib.mat4.perspective(fov, aspect, near, far, GL.immediate.currentMatrix));
  },

  gluLookAt: function(ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    GL.immediate.matrix.lib.mat4.lookAt(GL.immediate.matrix[GL.immediate.currentMatrix], [ex, ey, ez],
        [cx, cy, cz], [ux, uy, uz]);
  },

  gluProject: function(objX, objY, objZ, model, proj, view, winX, winY, winZ) {
    // The algorithm for this functions comes from Mesa

    var inVec = new Float32Array(4);
    var outVec = new Float32Array(4);
    GL.immediate.matrix.lib.mat4.multiplyVec4({{{ makeHEAPView('F64', 'model', 'model+16*8') }}},
        [objX, objY, objZ, 1.0], outVec);
    GL.immediate.matrix.lib.mat4.multiplyVec4({{{ makeHEAPView('F64', 'proj', 'proj+16*8') }}},
        outVec, inVec);
    if (inVec[3] == 0.0) {
      return 0 /* GL_FALSE */;
    }
    inVec[0] /= inVec[3];
    inVec[1] /= inVec[3];
    inVec[2] /= inVec[3];
    // Map x, y and z to range 0-1 */
    inVec[0] = inVec[0] * 0.5 + 0.5;
    inVec[1] = inVec[1] * 0.5 + 0.5;
    inVec[2] = inVec[2] * 0.5 + 0.5;
    // Map x, y to viewport
    inVec[0] = inVec[0] * {{{ makeGetValue('view', '2*4', 'i32') }}} + {{{ makeGetValue('view', '0*4', 'i32') }}};
    inVec[1] = inVec[1] * {{{ makeGetValue('view', '3*4', 'i32') }}} + {{{ makeGetValue('view', '1*4', 'i32') }}};

    {{{ makeSetValue('winX', '0', 'inVec[0]', 'double') }}};
    {{{ makeSetValue('winY', '0', 'inVec[1]', 'double') }}};
    {{{ makeSetValue('winZ', '0', 'inVec[2]', 'double') }}};

    return 1 /* GL_TRUE */;
  },

  gluUnProject: function(winX, winY, winZ, model, proj, view, objX, objY, objZ) {
    var result = GL.immediate.matrix.lib.mat4.unproject([winX, winY, winZ],
        {{{ makeHEAPView('F64', 'model', 'model+16*8') }}},
        {{{ makeHEAPView('F64', 'proj', 'proj+16*8') }}},
        {{{ makeHEAPView('32', 'view', 'view+4*4') }}});

    if (result === null) {
      return 0 /* GL_FALSE */;
    }

    {{{ makeSetValue('objX', '0', 'result[0]', 'double') }}};
    {{{ makeSetValue('objY', '0', 'result[1]', 'double') }}};
    {{{ makeSetValue('objZ', '0', 'result[2]', 'double') }}};

    return 1 /* GL_TRUE */;
  }
};

// Simple pass-through functions. Starred ones have return values. [X] ones have X in the C name but not in the JS name
[[0, 'shadeModel fogi fogfv getError* finish flush'],
 [1, 'clearDepth clearDepth[f] depthFunc enable disable frontFace cullFace clear enableVertexAttribArray disableVertexAttribArray lineWidth clearStencil depthMask stencilMask checkFramebufferStatus* generateMipmap activeTexture blendEquation polygonOffset hint sampleCoverage isEnabled*'],
 [2, 'blendFunc blendEquationSeparate depthRange depthRange[f] stencilMaskSeparate'],
 [3, 'texParameteri texParameterf drawArrays vertexAttrib2f stencilFunc stencilOp'],
 [4, 'viewport clearColor scissor vertexAttrib3f colorMask drawElements renderbufferStorage blendFuncSeparate blendColor stencilFuncSeparate stencilOpSeparate'],
 [5, 'vertexAttrib4f'],
 [6, 'vertexAttribPointer'],
 [8, 'copyTexImage2D copyTexSubImage2D']].forEach(function(data) {
  var num = data[0];
  var names = data[1];
  var args = range(num).map(function(i) { return 'x' + i }).join(', ');
  var plainStub = '(function(' + args + ') { ' + (num > 0 ? 'Module.ctx.NAME(' + args + ')' : '') + ' })';
  var returnStub = '(function(' + args + ') { ' + (num > 0 ? 'return Module.ctx.NAME(' + args + ')' : '') + ' })';
  names.split(' ').forEach(function(name) {
    var stub = plainStub;
    if (name[name.length-1] == '*') {
      name = name.substr(0, name.length-1);
      stub = returnStub;
    }
    var cName = name;
    if (name.indexOf('[') >= 0) {
      cName = name.replace('[', '').replace(']', '');
      name = cName.substr(0, cName.length-1);
    }
    var cName = 'gl' + cName[0].toUpperCase() + cName.substr(1);
    assert(!(cName in LibraryGL), "Cannot reimplement the existing function " + cName);
    LibraryGL[cName] = eval(stub.replace('NAME', name));
  });
});

autoAddDeps(LibraryGL, '$GL');

// Emulation requires everything else, potentially
LibraryGL.$GLEmulation__deps = LibraryGL.$GLEmulation__deps.slice(0);
for (var item in LibraryGL) {
  if (item != '$GLEmulation' && item.substr(-6) != '__deps' && item.substr(-9) != '__postset' && item.substr(0, 2) == 'gl') {
    LibraryGL.$GLEmulation__deps.push(item);
  }
}

mergeInto(LibraryManager.library, LibraryGL);

