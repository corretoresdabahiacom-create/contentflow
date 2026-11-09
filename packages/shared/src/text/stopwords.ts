const split = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

export const STOPWORDS: Record<'en' | 'pt' | 'es', Set<string>> = {
  en: split(`a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your`),
  pt: split(`a ao aos as até com como da das de dela dele deles depois do dos e ela elas ele eles em entre era eram essa essas esse esses esta estas este estes eu foi foram há isso isto já lhe mais mas me mesmo meu minha muito na nas nem no nos nós não o os ou para pela pelas pelo pelos por qual quando que quem se sem ser seu sua também te tem têm um uma umas uns você vocês é são só tua teu`),
  es: split(`a al algo algunos ante como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era eran es esa esas ese esos esta estas este estos fue fueron ha han hasta hay la las le les lo los me mi mis muy más ni no nos nosotros o os otra otro para pero por porque que quien se sin sobre son su sus también te tu tus un una uno unos y ya yo`),
};

export const isStopword = (word: string, lang: string): boolean => {
  const w = word.toLowerCase();
  if (lang === 'en' || lang === 'pt' || lang === 'es') return STOPWORDS[lang].has(w);
  return STOPWORDS.en.has(w) || STOPWORDS.pt.has(w) || STOPWORDS.es.has(w);
};
