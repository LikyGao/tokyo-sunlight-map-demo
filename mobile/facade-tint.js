/* Screen-space facade tint. No added geometry, depth writes, or shadow caster. */
function createFacadeTintLayer(onError) {
  let map, gl, program, vao, texture, maskTexture, framebuffer, width=0, height=0, modelMask=null;
  let selection=null, floor=null, origin=null, scale=1, edges=[], bounds=null;
  const uniforms={};
  const vertex=`#version 300 es
  void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
  const fragment=`#version 300 es
  precision highp float;
  // Sampler precision controls texture results independently of float precision.
  uniform highp sampler2D uDepth;
  uniform lowp sampler2D uMask;
  uniform bool uUseMask;
  uniform vec2 uSize,uRange,uFloor;
  uniform mat4 uInverse;
  uniform vec4 uEdges[128];
  uniform int uCount,uMode;
  uniform vec2 uHeight;
  out vec4 color;
  void main(){
    vec2 uv=gl_FragCoord.xy/uSize;
    float d=texture(uDepth,uv).r;
    vec4 h=uInverse*vec4(uv*2.0-1.0,2.0*(d-uRange.x)/(uRange.y-uRange.x)-1.0,1.0);
    vec3 p=h.xyz/h.w;
    vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
    // Derivatives must run for the whole fragment quad before any discard.
    float feather=max(fwidth(p.z),0.02);
    if(uUseMask&&texture(uMask,vec2(uv.x,1.0-uv.y)).r<0.5)discard;
    if(d>=0.9999999)discard;
    if(p.z<uHeight.x-0.5||p.z>uHeight.y+0.5)discard;
    bool inside=false;float distanceToEdge=1e20;
    for(int i=0;i<128;i++){
      if(i>=uCount)break;
      vec2 a=uEdges[i].xy,b=uEdges[i].zw,e=b-a;
      if((a.y>p.y)!=(b.y>p.y)){
        if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
      }
      float t=clamp(dot(p.xy-a,e)/max(dot(e,e),0.00001),0.0,1.0);
      distanceToEdge=min(distanceToEdge,length(p.xy-a-t*e));
    }
    // A tolerance in the selection mask never creates new visible surfaces.
    if(!uUseMask&&!inside&&distanceToEdge>2.5)discard;
    if(uMode==1){
      if(p.z<uFloor.x||p.z>=uFloor.y||abs(normal.z)>0.8)discard;
      float coverage=smoothstep(uFloor.x,uFloor.x+feather,p.z)*(1.0-smoothstep(uFloor.y-feather,uFloor.y,p.z));
      color=vec4(mix(vec3(1.0),vec3(1.0,0.64,0.10),coverage),1.0);
    }else{discard;}
  }`;
  function shader(type, source){
    const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(message);}
    return s;
  }
  function setSelection(feature){
    selection=null;floor=null;edges=[];modelMask=null;
    if(feature){
      if(!program){onError('この環境では外壁の着色を表示できません。');return false;}
      const center=turf.centerOfMass(feature).geometry.coordinates;
      origin=mapboxgl.MercatorCoordinate.fromLngLat(center);scale=origin.meterInMercatorCoordinateUnits();
      const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
      for(const polygon of polygons)for(const ring of polygon)for(let i=0;i<ring.length-1;i++){
        const a=mapboxgl.MercatorCoordinate.fromLngLat(ring[i]),b=mapboxgl.MercatorCoordinate.fromLngLat(ring[i+1]);
        edges.push((a.x-origin.x)/scale,(a.y-origin.y)/scale,(b.x-origin.x)/scale,(b.y-origin.y)/scale);
      }
      if(edges.length/4>128){onError('この複雑な輪郭の着色は未対応です。');}
      else selection={base:Number(feature.properties.min_height)||0,height:Number(feature.properties.height)};
      const xs=[],ys=[];for(let i=0;i<edges.length;i+=2){xs.push(edges[i]);ys.push(edges[i+1]);}
      bounds=[Math.min(...xs)-3,Math.min(...ys)-3,Math.max(...xs)+3,Math.max(...ys)+3];
    }
    map?.triggerRepaint();
    return !!selection;
  }
  return {
    id:'facade-tint',type:'custom',renderingMode:'3d',
    setSelection,
    setModelSelection(feature){
      setSelection(null);
      const coordinates=feature.geometry?.coordinates, height=Number(feature.properties.height);
      if(!program||feature.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length<2||!coordinates.slice(0,2).every(Number.isFinite)||!Number.isFinite(height)||height<=0)return false;
      origin=mapboxgl.MercatorCoordinate.fromLngLat(coordinates);
      scale=origin.meterInMercatorCoordinateUnits();
      selection={base:0,height,model:true};bounds=null;
      return true;
    },
    setModelMask(mask){modelMask=mask?{...mask,dirty:true}:null;map?.triggerRepaint();},
    setFloor(low,high){floor=low==null?null:[low,high];map?.triggerRepaint();return !!selection;},
    onAdd(m,g){
      map=m;gl=g;
      try{
        const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
        program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
        for(const key of ['uDepth','uMask','uUseMask','uSize','uRange','uFloor','uInverse','uEdges[0]','uCount','uMode','uHeight'])uniforms[key]=gl.getUniformLocation(program,key);
        vao=gl.createVertexArray();texture=gl.createTexture();maskTexture=gl.createTexture();framebuffer=gl.createFramebuffer();
        const binding=gl.getParameter(gl.TEXTURE_BINDING_2D),alignment=gl.getParameter(gl.UNPACK_ALIGNMENT);
        gl.bindTexture(gl.TEXTURE_2D,maskTexture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,1,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([0]));
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D,binding);gl.pixelStorei(gl.UNPACK_ALIGNMENT,alignment);
      }catch(error){onError('外壁の着色を開始できません。');console.error('Facade tint initialization:',error);program=null;}
    },
    render(g,matrix){
      if(!selection||!floor||!program||map.getZoom()<15)return;
      if(selection.model&&(!modelMask||modelMask.width!==gl.drawingBufferWidth||modelMask.height!==gl.drawingBufferHeight))return;
      const draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      const viewport=gl.getParameter(gl.VIEWPORT),range=gl.getParameter(gl.DEPTH_RANGE);
      const oldProgram=gl.getParameter(gl.CURRENT_PROGRAM),oldVao=gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);
      const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.activeTexture(gl.TEXTURE1);const oldMaskTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
      const alignment=gl.getParameter(gl.UNPACK_ALIGNMENT);gl.activeTexture(gl.TEXTURE0);
      const scissor=gl.isEnabled(gl.SCISSOR_TEST),depth=gl.isEnabled(gl.DEPTH_TEST),blend=gl.isEnabled(gl.BLEND),stencil=gl.isEnabled(gl.STENCIL_TEST),cull=gl.isEnabled(gl.CULL_FACE);
      const scissorBox=gl.getParameter(gl.SCISSOR_BOX);
      const depthMask=gl.getParameter(gl.DEPTH_WRITEMASK);
      const blendValues=[gl.BLEND_SRC_RGB,gl.BLEND_DST_RGB,gl.BLEND_SRC_ALPHA,gl.BLEND_DST_ALPHA,gl.BLEND_EQUATION_RGB,gl.BLEND_EQUATION_ALPHA].map(p=>gl.getParameter(p));
      const w=viewport[2],h=viewport[3];
      try{
        gl.disable(gl.SCISSOR_TEST);gl.bindTexture(gl.TEXTURE_2D,texture);
        if(width!==w||height!==h){
          width=w;height=h;
          gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH24_STENCIL8,w,h,0,gl.DEPTH_STENCIL,gl.UNSIGNED_INT_24_8,null);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,texture,0);
          gl.drawBuffers([gl.NONE]);
          if(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Depth framebuffer unavailable');
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,draw);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);
        gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
        if(gl.getError()!==gl.NO_ERROR)throw new Error('Depth copy unsupported');
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);
        const local=new THREE.Matrix4().fromArray(matrix).multiply(new THREE.Matrix4().makeTranslation(origin.x,origin.y,0)).multiply(new THREE.Matrix4().makeScale(scale,scale,scale));
        // Shade only the projected selected volume, not the entire viewport.
        const pixels=[];let crossesCamera=false;
        if(bounds)for(const x of [bounds[0],bounds[2]])for(const y of [bounds[1],bounds[3]])for(const z of floor||[selection.base-1,selection.height+1]){
          const p=new THREE.Vector4(x,y,z,1).applyMatrix4(local);
          if(p.w<=0){crossesCamera=true;break;}
          pixels.push([(p.x/p.w+1)*w/2,(p.y/p.w+1)*h/2]);
        }
        if(bounds&&!crossesCamera){
          const x=Math.max(0,Math.floor(Math.min(...pixels.map(p=>p[0])))-4),y=Math.max(0,Math.floor(Math.min(...pixels.map(p=>p[1])))-4);
          const right=Math.min(w,Math.ceil(Math.max(...pixels.map(p=>p[0])))+4),top=Math.min(h,Math.ceil(Math.max(...pixels.map(p=>p[1])))+4);
          gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,Math.max(0,right-x),Math.max(0,top-y));
        }
        gl.useProgram(program);gl.bindVertexArray(vao);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.depthMask(false);
        gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFuncSeparate(gl.ZERO,gl.SRC_COLOR,gl.ZERO,gl.ONE);
        gl.uniform1i(uniforms.uDepth,0);gl.uniform2f(uniforms.uSize,w,h);gl.uniform2fv(uniforms.uRange,range);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,maskTexture);
        if(selection.model&&modelMask.dirty){
          gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,w,h,0,gl.RED,gl.UNSIGNED_BYTE,modelMask.data);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          modelMask.dirty=false;
        }
        gl.uniform1i(uniforms.uMask,1);gl.uniform1i(uniforms.uUseMask,selection.model?1:0);
        gl.uniformMatrix4fv(uniforms.uInverse,false,new Float32Array(local.invert().elements));
        if(edges.length)gl.uniform4fv(uniforms['uEdges[0]'],new Float32Array(edges));gl.uniform1i(uniforms.uCount,edges.length/4);
        gl.uniform2f(uniforms.uHeight,selection.base,selection.height);gl.uniform1i(uniforms.uMode,1);
        gl.uniform2fv(uniforms.uFloor,floor||[0,0]);gl.drawArrays(gl.TRIANGLES,0,3);
      }catch(error){selection=null;onError('この環境では外壁の着色を表示できません。');console.error('Facade tint:',error);}
      finally{
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT,alignment);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,oldMaskTexture);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.activeTexture(active);gl.useProgram(oldProgram);gl.bindVertexArray(oldVao);
        gl.depthMask(depthMask);gl.blendFuncSeparate(...blendValues.slice(0,4));gl.blendEquationSeparate(...blendValues.slice(4));
        gl.scissor(...scissorBox);
        for(const [cap,enabled] of [[gl.SCISSOR_TEST,scissor],[gl.DEPTH_TEST,depth],[gl.BLEND,blend],[gl.STENCIL_TEST,stencil],[gl.CULL_FACE,cull]])enabled?gl.enable(cap):gl.disable(cap);
      }
    },
    onRemove(){gl.deleteProgram(program);gl.deleteVertexArray(vao);gl.deleteTexture(texture);gl.deleteTexture(maskTexture);gl.deleteFramebuffer(framebuffer);}
  };
}
