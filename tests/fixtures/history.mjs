import { emptyState, validateState, SCALE } from '../../public/finance.mjs';
export function largeHistory() {
  const state=emptyState('Histórico sintético','2000-01-01');
  state.accounts=[
    {id:'bank',name:'Conta sintética',kind:'bank',opening:1_000_000,openingDate:'1999-12-31',archived:false},
    {id:'broker',name:'Corretora sintética',kind:'investment',opening:1_000_000,openingDate:'1999-12-31',archived:false},
  ];
  state.assets=[{id:'asset',symbol:'TEST3',name:'Ativo sintético',kind:'stock',manualPrice:1000,priceDate:'2000-01-01',source:'Fixture sintética'}];
  const date=i=>new Date(Date.UTC(2000,0,i+1,12)).toISOString().slice(0,10);
  const id=(type,i)=>type+'-'+String(i).padStart(3,'0');
  state.transfers=Array.from({length:25},(_,i)=>({id:id('transfer',i),fromId:'bank',toId:'broker',amount:1000,date:date(i),note:'Transferência sintética'}));
  state.trades=Array.from({length:65},(_,i)=>({id:id('trade',i),assetId:'asset',accountId:'broker',side:'buy',quantity:SCALE,price:1000,fees:0,date:date(i)}));
  state.dividends=Array.from({length:65},(_,i)=>({id:id('dividend',i),assetId:'asset',accountId:'broker',amount:1234,date:date(i),status:'announced'}));
  return validateState(state);
}
