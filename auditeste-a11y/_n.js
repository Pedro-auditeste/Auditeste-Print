require('./carregar-env.js').carregarEnvs();
const puppeteer=require('puppeteer'),{caminhoChrome}=require('./a11y.js');
const CH=process.env.AGENTE_API_KEY;
(async()=>{
 const b=await puppeteer.launch({headless:true,executablePath:caminhoChrome(),args:['--no-sandbox']});
 const p=await b.newPage(); await p.setViewport({width:1200,height:700});
 await p.setContent('<body style="font:14px system-ui;padding:20px"><h1>Meus benefícios</h1><p>Nenhum benefício ativo.</p></body>');
 const img='data:image/jpeg;base64,'+await p.screenshot({type:'jpeg',quality:80,encoding:'base64'});
 await b.close();
 console.log('tamanho da imagem: '+Math.round(img.length*0.75/1024)+' KB');
 for(const tent of [1,2]){
  const t=Date.now();
  try{
   const r=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{method:'POST',
    headers:{Authorization:'Bearer '+CH,'Content-Type':'application/json'},
    body:JSON.stringify({model:'meta/llama-3.2-11b-vision-instruct',max_tokens:300,temperature:0.05,
     messages:[{role:'user',content:[{type:'text',text:'Descreva a tela em 2 frases.'},{type:'image_url',image_url:{url:img}}]}]}),
    signal:AbortSignal.timeout(120000)});
   const j=await r.json().catch(()=>({}));
   console.log('tentativa '+tent+': HTTP '+r.status+'  '+((Date.now()-t)/1000).toFixed(1)+'s  '+
     String(j.choices?.[0]?.message?.content||JSON.stringify(j)).replace(/\s+/g,' ').slice(0,90));
  }catch(e){ console.log('tentativa '+tent+': ERRO '+((Date.now()-t)/1000).toFixed(1)+'s  '+e.message); }
 }
})();
