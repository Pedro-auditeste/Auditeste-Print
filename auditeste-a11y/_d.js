const puppeteer=require('puppeteer'),{caminhoChrome}=require('./a11y.js');
const tela=(t,c,extra)=>`<body style="margin:0;font:14px system-ui;background:${c};width:1200px">
 <div style="background:#0d3446;color:#fff;padding:12px 18px">Portal do Colaborador</div>
 <h1 style="padding:16px 18px;margin:0;font-size:24px">${t}</h1>
 <div style="padding:0 18px">${extra}</div></body>`;
(async()=>{
 const b=await puppeteer.launch({headless:true,executablePath:caminhoChrome(),args:['--no-sandbox']});
 const p=await b.newPage(); await p.setViewport({width:1200,height:700});
 await p.setContent(tela('Olá, Maria!','#fff','<p>Aqui você acompanha seus benefícios.</p><button style="padding:12px 22px;font-size:16px">Meus benefícios</button>'));
 const a=await p.screenshot({type:'jpeg',quality:80,encoding:'base64'});
 await p.setContent(tela('Meus benefícios','#eef7ff','<p>Nenhum benefício ativo no momento.</p><table><tr><td>Plano</td><td>Não contratado</td></tr></table>'));
 const d=await p.screenshot({type:'jpeg',quality:80,encoding:'base64'});
 await b.close();
 const url=x=>'data:image/jpeg;base64,'+x;
 const t=Date.now();
 const r=await fetch('https://audiprint.up.railway.app/descrever',{method:'POST',
  headers:{'Content-Type':'application/json','Origin':'https://audiprint.up.railway.app'},
  body:JSON.stringify({imagem:url(d),antes:url(a),par:url(d),acao:'Clicar',rotulo:'Meus benefícios',
   elemento:'//button[.="Meus benefícios"]',urlAntes:'https://p.test/home',urlDepois:'https://p.test/beneficios'}),
  signal:AbortSignal.timeout(150000)});
 const j=await r.json();
 console.log('HTTP '+r.status+'  '+((Date.now()-t)/1000).toFixed(1)+'s');
 console.log('legenda    :',(j.legenda_curta||'').slice(0,110));
 console.log('descricao  :',(j.descricao_detalhada||'').slice(0,140));
 console.log('gherkin    :',j.gherkin?'SIM':'VAZIO  <-- caiu no fallback');
 console.log('titulo_cen :',j.titulo_cenario||'(vazio)');
})();
