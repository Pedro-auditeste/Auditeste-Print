const puppeteer=require('puppeteer'),{caminhoChrome}=require('./a11y.js');
const px='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';
const PASSO={id:'x1',titulo:'Clicou em "Home"',obs:'Descrição pendente.',acao:'Clicar',
 elemento:'//a[normalize-space(.)="Home"]',rotulo:'Home',html:'<a href="/">Home</a>',
 urlAntes:'https://p.test/a',urlDepois:'https://p.test/b',
 textoAntes:{titulo:'Portal',cabecalho:'Olá, Maria!'},textoDepois:{titulo:'Home',cabecalho:'Home'},
 imagens:[{dataUrl:px,legenda:'Antes'},{dataUrl:px,legenda:'Depois'}]};
(async()=>{
 const b=await puppeteer.launch({headless:true,executablePath:caminhoChrome(),args:['--no-sandbox']});
 const p=await b.newPage();
 p.on('pageerror',e=>console.log('ERRO PAGINA:',e.message));
 let corpo=null;
 await p.setRequestInterception(true);
 p.on('request',r=>{
   if(r.url().endsWith('/descrever')){ try{corpo=JSON.parse(r.postData()||'{}')}catch(_){}
     r.respond({status:200,contentType:'application/json',body:JSON.stringify({
       legenda_curta:'Clique em Home abriu a home',descricao_detalhada:'Antes o painel, depois a home.',
       titulo_cenario:'Abrir a home',gherkin:'Cenário: Abrir a home\n  Dado que estou no painel\n  Quando clico em Home\n  Então vejo a home'})});
   } else r.continue();
 });
 await p.goto('http://127.0.0.1:8900',{waitUntil:'domcontentloaded'});
 await p.click('#entrarSite'); await p.waitForSelector('#telaProjetos.ativa');
 await p.click('[data-acao="novoProjeto"]'); await p.waitForSelector('#campoNome',{visible:true});
 await p.type('#campoNome','V'); await p.click('#btnConfirmarModal');
 await p.waitForSelector('#gradeProjetos .cartao[data-projeto]'); await p.click('#gradeProjetos .cartao[data-projeto]');
 await p.waitForSelector('[data-acao="novaGravacao"]'); await p.click('[data-acao="novaGravacao"]');
 await p.waitForSelector('#telaGravador.ativa');
 await p.evaluate(pa=>postMessage({tipo:'AUDI_PRINT_PASSO',passo:pa,origem:{url:'https://p.test',titulo:'Portal'}},location.origin),PASSO);
 await new Promise(r=>setTimeout(r,6000));
 const est=await p.evaluate(()=>{const e=document.querySelector('#lista .passo');return e?{
   estado:e.dataset.descricaoEstado||'(nenhum)',titulo:e.querySelector('.titulo')?.textContent.trim(),
   obs:e.querySelector('.obs')?.textContent.trim().slice(0,90),
   temJson:!!e.querySelector('.captura-json'),temGherkin:!!e.querySelector('.analise-qa pre')}:null;});
 console.log('passo:',JSON.stringify(est,null,1));
 console.log('/descrever chamado:',corpo?'SIM':'NAO', corpo?('acao='+corpo.acao+' valor='+JSON.stringify(corpo.valor)):'');
 await b.close();
})();
