const regex = /(?<!#)(\w+)\.(\w+)/g;
const str = 'button#chat.settings';
const matches = Array.from(str.matchAll(regex));
console.log(matches.map(([match, comp, ctx]) => ({ match, comp, ctx })));
