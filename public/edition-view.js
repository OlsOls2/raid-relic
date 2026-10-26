import {selectEdition,editionImageURL,editionWindowLabel,FAN_DISCLAIMER} from './editions.js';
const views=new WeakMap();
// Cosmetic DOM only; keyed by edition, no timer/RAF/fetch and no participant data.
export function presentEdition(archive,now=Date.now(),{label=true}={}){
 if(!archive?.ownerDocument||!archive.dataset)return null;
 let v=views.get(archive);if(!v){v={id:undefined,image:archive.querySelector('.crystal')??archive.querySelector('img')};v.original=v.image?.getAttribute('src');views.set(archive,v);}
 const e=selectEdition(now),id=e?.id??'base';if(v.id===id&&v.labelMode===label)return e;v.id=id;v.labelMode=label;archive.dataset.edition=id;
 if(v.image&&v.original){v.image.setAttribute('src',editionImageURL(e)??v.original);}
 if(e&&label){if(!v.label){v.label=archive.ownerDocument.createElement('p');v.label.className='edition-label';archive.after(v.label);}v.label.textContent='Edition: '+e.name+' · '+editionWindowLabel(e)+' · cosmetic. '+FAN_DISCLAIMER;v.label.style.cssText='font:11px/1.35 system-ui;color:#e6bb70;text-align:center;margin:3px 0;max-width:100%;overflow-wrap:normal';v.label.hidden=archive.ownerDocument.body?.classList.contains('corner')??false;archive.setAttribute('title',v.label.textContent);}
 else{v.label?.remove();v.label=null;if(e)archive.setAttribute('title','Cosmetic edition: '+e.name+' · '+editionWindowLabel(e)+'. '+FAN_DISCLAIMER);else archive.removeAttribute('title');}
 return e;
}
