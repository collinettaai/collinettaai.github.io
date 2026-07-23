/* CollinettaAI - animazione splash (emblema diapason + martelletto Tromner) */
(function(){
  "use strict";
  var CX=190,CY=100,SF=0.95,SS=0.36,FX=100,HX=280;
  var A=300,HOLD=1080,B=1900,CYC=1250,SETTLE=300;
  var C=0.8, HDX=10, HPX=CX+HDX*SF;
  var H={ topCapW:4.5, topCapH:4.25, topCapY:14.5, topCapRx:0.9, capW:33, capH:10.25, capY:17.5, shaftW:3.9, shaftTopY:26, shaftBotY:56, padTopHW:2.5, padTopY:52.5, padWideHW:6, padWideY:75, padBotY:89.5, botScrewW:4.25, botScrewH:4, botScrewY:88, botScrewRx:1.2 };
  var F={ weightW:4.5, weightH:14, weightY:13, weightRx:1.6, tineSpread:6.5, tineW:2.7, tineTopY:24, junctionY:64, junctionCurve:9, stemW:3.6, stemBotY:84, footCollarW:5, footCollarH:3.8, footCollarY:84, footCollarRx:1, footDiscW:9.5, footDiscH:4.6, footDiscY:87, footDiscRx:2.3 };
  var R=function(x,y,w,h,rx,c,sa){return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+rx+'" fill="'+c+'"'+(sa||'')+'/>';};
  var L=function(x1,y1,x2,y2,w,c,cap){return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+c+'" stroke-width="'+w+'" stroke-linecap="'+(cap||'round')+'"/>';};
  var gHam=document.getElementById('cl-ham'),gFork=document.getElementById('cl-fork'),wm=document.getElementById('cl-wm');
  if(!gHam||!gFork){ return; }
  // Uso le CSS variables direttamente nei fill SVG (non valori hex risolti una sola volta):
  // così i colori seguono il tema in tempo reale. Senza questo, se il tema cambiava
  // dark→light DOPO il disegno dell'SVG, i fill restavano quelli vecchi e le lettere/oggetti
  // diventavano invisibili (stesso colore del nuovo sfondo).
  var INK='var(--ink)', BG='var(--bg)';
  if(wm){ wm.setAttribute('fill', INK); wm.style.fill = INK; }

  function fork(col,infl){
    var sa = infl>0?' stroke="'+col+'" stroke-width="'+(2*infl)+'" stroke-linejoin="round" stroke-linecap="round"':'';
    var sp=F.tineSpread, tw=F.tineW, yTop=F.tineTopY, yMerge=F.junctionY, jc=F.junctionCurve, sw=F.stemW, yBot=F.stemBotY;
    var lxc=50-sp, rxc=50+sp;
    var xLO=lxc-tw/2, xLI=lxc+tw/2, xRI=rxc-tw/2, xRO=rxc+tw/2;
    var sxL=50-sw/2, sxR=50+sw/2, yArm=yMerge-jc;
    var body='M'+xLO+' '+yTop+' L'+xLO+' '+yArm+' '
      +'C'+xLO+' '+(yArm+jc*0.5)+' '+sxL+' '+(yMerge-jc*0.4)+' '+sxL+' '+yMerge+' '
      +'L'+sxL+' '+yBot+' L'+sxR+' '+yBot+' L'+sxR+' '+yMerge+' '
      +'C'+sxR+' '+(yMerge-jc*0.4)+' '+xRO+' '+(yArm+jc*0.5)+' '+xRO+' '+yArm+' '
      +'L'+xRO+' '+yTop+' L'+xRI+' '+yTop+' L'+xRI+' '+yArm+' '
      +'C'+xRI+' '+(yArm+jc*0.7)+' '+xLI+' '+(yArm+jc*0.7)+' '+xLI+' '+yArm+' '
      +'L'+xLI+' '+yTop+' Z';
    var wL=lxc-F.weightW/2, wR=rxc-F.weightW/2, cX=50-F.footCollarW/2, dX=50-F.footDiscW/2;
    return R(dX,F.footDiscY,F.footDiscW,F.footDiscH,F.footDiscRx,col,sa)
      + R(cX,F.footCollarY,F.footCollarW,F.footCollarH,F.footCollarRx,col,sa)
      + '<path d="'+body+'" fill="'+col+'"'+sa+'/>'
      + R(wL,F.weightY,F.weightW,F.weightH,F.weightRx,col,sa)
      + R(wR,F.weightY,F.weightW,F.weightH,F.weightRx,col,sa);
  }
  function hammer(col,infl){
    var sa = infl>0?' stroke="'+col+'" stroke-width="'+(2*infl)+'" stroke-linejoin="round" stroke-linecap="round"':'';
    var capX=50-H.capW/2, topX=50-H.topCapW/2, botX=50-H.botScrewW/2;
    var tHW=H.padTopHW, wHW=H.padWideHW, tY=H.padTopY, wY=H.padWideY, bY=H.padBotY;
    var k1=(wY-tY)*0.45, k2=(wY-tY)*0.32, k3=(bY-wY)*0.6;
    var path='M'+(50-tHW)+' '+tY+' C'+(50-tHW)+' '+(tY+k1)+' '+(50-wHW)+' '+(wY-k2)+' '+(50-wHW)+' '+wY+' '
      +'C'+(50-wHW)+' '+(bY-k3)+' '+(50-3)+' '+bY+' 50 '+(bY+0.4)+' C'+(50+3)+' '+bY+' '+(50+wHW)+' '+(bY-k3)+' '+(50+wHW)+' '+wY+' '
      +'C'+(50+wHW)+' '+(wY-k2)+' '+(50+tHW)+' '+(tY+k1)+' '+(50+tHW)+' '+tY+' Z';
    return R(topX,H.topCapY,H.topCapW,H.topCapH,H.topCapRx,col,sa)
      + R(capX,H.capY,H.capW,H.capH,H.capH/2,col,sa)
      + L(50,H.shaftTopY,50,H.shaftBotY,H.shaftW+2*infl,col)
      + '<path d="'+path+'" fill="'+col+'"'+sa+'/>'
      + R(botX,H.botScrewY,H.botScrewW,H.botScrewH,H.botScrewRx,col,sa);
  }
  gHam.innerHTML  = hammer(BG, C) + hammer(INK, 0);
  gFork.innerHTML = fork(BG, C)   + fork(INK, 0);

  function setT(el,px,ang,s){ el.setAttribute('transform','translate('+px.toFixed(2)+' '+CY+') rotate('+ang.toFixed(2)+') scale('+s.toFixed(3)+') translate(-50 -60)'); }
  var curr={fpx:FX,hpx:HX,fang:0,hang:0,s:SS,op:0,top:0};
  function place(fpx,hpx,fang,hang,s,op,top){
    curr={fpx:fpx,hpx:hpx,fang:fang,hang:hang,s:s,op:op,top:top};
    setT(gHam,hpx,hang,s); setT(gFork,fpx,fang,s);
    gHam.style.opacity=op; gFork.style.opacity=op; if(wm) wm.style.opacity=top;
  }
  function lerp(a,b,k){ return a+(b-a)*k; }
  function eo(x){ return 1-Math.pow(1-x,3); }
  function easeLoop(x){ return x<0.5 ? Math.pow(2*x,2.6)/2 : 1-Math.pow(2-2*x,2.6)/2; }
  function snap(a,base){ return base+360*Math.round((a-base)/360); }

  var reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf=null,t0=null,mode='run',sFrom=null,sTo=null,sStart=0,done=false;

  function frame(ts){
    if(mode==='settle'){
      var k=eo(Math.min(1,(ts-sStart)/SETTLE));
      place(lerp(sFrom.fpx,sTo.fpx,k),lerp(sFrom.hpx,sTo.hpx,k),lerp(sFrom.fang,sTo.fang,k),lerp(sFrom.hang,sTo.hang,k),lerp(sFrom.s,sTo.s,k),1,lerp(sFrom.top,0,k));
      if(k>=1){ done=true; raf=null; return; }
      raf=requestAnimationFrame(frame); return;
    }
    if(t0===null) t0=ts;
    var t=ts-t0;
    if(t<A){ var o=t/A; place(FX,HX,0,0,SS,o,o); }
    else if(t<HOLD){ place(FX,HX,0,0,SS,1,1); }
    else if(t<B){ var e=eo((t-HOLD)/(B-HOLD)); place(FX+(CX-FX)*e,HX+(HPX-HX)*e,405*e,-405*e,SS+(SF-SS)*e,1,Math.max(0,1-e/0.55)); }
    else { var tt=t-B,tau=(tt%CYC)/CYC,spin=360*easeLoop(tau); place(CX,HPX,45+spin,-45-spin,SF,1,0); }
    raf=requestAnimationFrame(frame);
  }
  function startSettle(){
    if(done||mode==='settle') return;
    sFrom={fpx:curr.fpx,hpx:curr.hpx,fang:curr.fang,hang:curr.hang,s:curr.s,top:curr.top};
    sTo={fpx:CX,hpx:HPX,fang:snap(curr.fang,45),hang:snap(curr.hang,-45),s:SF,top:0};
    sStart=performance.now(); mode='settle';
    if(!raf) raf=requestAnimationFrame(frame);
  }
  window.CollinettaSplash={
    finish:function(){ if(!reduce) startSettle(); },
    restart:function(){
      if(reduce){ place(CX,HPX,45,-45,SF,1,0); return; }
      if(raf){ cancelAnimationFrame(raf); raf=null; }
      t0=null; mode='run'; done=false;
      place(FX,HX,0,0,SS,0,0);
      raf=requestAnimationFrame(frame);
    }
  };

  if(reduce){ place(CX,HPX,45,-45,SF,1,0); }
  else { place(FX,HX,0,0,SS,0,0); raf=requestAnimationFrame(frame); }
})();
