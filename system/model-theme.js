// 2D / 3D 模型共用亮色主題：白底、黑色建築線稿；科技主題維持原色。
(function(){
  function isLight(){return document.documentElement.getAttribute('data-theme')==='light';}

  function makeLightTexture(THREE,source){
    const img=source&&source.image;
    if(!img) return source;
    const mobile=matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    const sourceW=img.naturalWidth||img.videoWidth||img.width;
    const sourceH=img.naturalHeight||img.videoHeight||img.height;
    if(!sourceW||!sourceH) return source;
    try{
      // 亮色線稿只供 3D 視覺化；限制尺寸，避免四層 4K 複本造成行動裝置記憶體壓力。
      // Mobile Safari has a tight GPU/canvas budget. A 1024px light-theme
      // copy keeps the plan legible while using only 1/16 of a 4K canvas.
      // The original texture remains untouched for the technology theme.
      const maxSide=mobile?768:2048;
      const scale=Math.min(1,maxSide/Math.max(sourceW,sourceH));
      const w=Math.max(1,Math.round(sourceW*scale)),h=Math.max(1,Math.round(sourceH*scale));
      const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(img,0,0,w,h);
      const frame=ctx.getImageData(0,0,w,h), px=frame.data;
      for(let i=0;i<px.length;i+=4){
        if(!px[i+3]) continue;
        const r=px[i],g=px[i+1],b=px[i+2];
        // 將水藍／青色線段轉成近黑色；白色暈邊保留，白底上自然消失。
        if((g>r+16&&b>r+22)||(r<180&&g>145&&b>165)) px[i]=px[i+1]=px[i+2]=12;
      }
      ctx.putImageData(frame,0,0);
      const light=new THREE.CanvasTexture(canvas);
      light.minFilter=source.minFilter; light.magFilter=source.magFilter;
      light.wrapS=source.wrapS; light.wrapT=source.wrapT;
      light.anisotropy=source.anisotropy; light.flipY=source.flipY;
      if('colorSpace' in source) light.colorSpace=source.colorSpace;
      if('encoding' in source) light.encoding=source.encoding;
      light.needsUpdate=true;
      return light;
    }catch(e){return source;}
  }

  function registerFloor(THREE,fl,texture,renderer){
    const oldDark=fl.themeDarkTexture, oldLight=fl.themeLightTexture;
    fl.themeDarkTexture=texture;
    fl.themeLightTexture=makeLightTexture(THREE,texture);
    if(renderer){
      const a=renderer.capabilities.getMaxAnisotropy();
      texture.anisotropy=a;
      if(fl.themeLightTexture) fl.themeLightTexture.anisotropy=a;
    }
    if(fl.mesh){
      fl.mesh.material.map=isLight()?fl.themeLightTexture:fl.themeDarkTexture;
      fl.mesh.material.needsUpdate=true;
    }
    if(oldDark&&oldDark!==texture) oldDark.dispose();
    if(oldLight&&oldLight!==oldDark&&oldLight!==fl.themeLightTexture) oldLight.dispose();
  }

  function apply3D(scene,floors){
    const light=isLight(), bg=light?0xffffff:0x020b18, edge=light?0x111111:0x0a3a5a;
    if(scene){
      scene.background=new THREE.Color(bg);
      if(scene.fog&&scene.fog.color) scene.fog.color.setHex(bg);
    }
    (floors||[]).forEach(fl=>{
      if(fl.frame) fl.frame.traverse(o=>{if(o.material&&o.material.color)o.material.color.setHex(edge);});
      if(fl.mesh&&fl.themeDarkTexture){
        fl.mesh.material.map=light?fl.themeLightTexture:fl.themeDarkTexture;
        fl.mesh.material.needsUpdate=true;
      }
    });
  }

  function watch(callback){
    new MutationObserver(list=>{if(list.some(m=>m.attributeName==='data-theme'))callback();})
      .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  window.ModelTheme={isLight,registerFloor,apply3D,watch};
})();
