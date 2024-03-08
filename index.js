require('dotenv').config();
const stream = require("./stream");
const axios = require('axios').default;
const { Telegraf } = require('telegraf');
const { log, info, error } = require('console');
const { Spot } = require('@binance/connector');

const QUOTE = process.env.QUOTE;
const PROFITABILITY = parseFloat(process.env.PROFITABILITY);
const AMOUNT = parseFloat(process.env.AMOUNT);
const CRAWLER_INTERVAL = parseInt(process.env.CRAWLER_INTERVAL);

const bot = new Telegraf(process.env.TELEGRAM_API_BOT);
const client = new Spot(process.env.API_KEY, process.env.SECRET_KEY,);

async function exchangeInfo() {
  const response = await axios.get("https://api.binance.com/api/v3/exchangeInfo");
  return response.data.symbols.filter(s => s.status === 'TRADING').map(s => 
    ({
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset
    })
  );
}

function getBuyBuySell(buySymbols, allSymbols, symbolsMap) {
  const buyBuySell = [];

  for (let i = 0; i < buySymbols.length; i++) {
    const buy1 = buySymbols[i];

    const right = allSymbols.filter(s => s.quote === buy1.base);

    for (let j = 0; j < right.length; j++) {
      const buy2 = right[j];

      const sell1 = symbolsMap[buy2.base + buy1.quote];
      if (!sell1) continue;

      buyBuySell.push({ buy1, buy2, sell1 });
    }
  }
  return buyBuySell;
}

function getBuySellSell(buySymbols, allSymbols, symbolsMap) {
  const buySellSell = [];
  for (let i = 0; i < buySymbols.length; i++) {
    const buy1 = buySymbols[i];

    const right = allSymbols.filter(s => s.base === buy1.base && s.quote !== buy1.quote);

    for (let j = 0; j < right.length; j++) {
      const sell1 = right[j];

      const sell2 = symbolsMap[sell1.quote + buy1.quote];
      if (!sell2) continue;

      buySellSell.push({ buy1, sell1, sell2 });
    }
  }
  return buySellSell;
}

function getSymbolMap(symbols) {
  const map = {};
  symbols.map(s => map[s.symbol] = s);
  return map;
}

async function processBuyBuySell(buyBuySell, balance) {
  for (let i = 0; i < buyBuySell.length; i++) {
    const candidate = buyBuySell[i];

    //verifica se já temos todos os preços
    let priceBuy1 = stream.getBook(candidate.buy1.symbol);
    if (!priceBuy1) continue;
    priceBuy1 = parseFloat(priceBuy1.price);

    let priceBuy2 = stream.getBook(candidate.buy2.symbol);
    if (!priceBuy2) continue;
    priceBuy2 = parseFloat(priceBuy2.price);

    let priceSell1 = stream.getBook(candidate.sell1.symbol);
    if (!priceSell1) continue;

    priceSell1 = parseFloat(priceSell1.price);

    //se tem o preço dos 3, pode analisar a lucratividade
    const crossRate = (1 / priceBuy1) * (1 / priceBuy2) * priceSell1;
    if (crossRate > PROFITABILITY) {
      const orderExample1 = {
        symbol: candidate.buy1.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: priceBuy1,
        quantity: balance,
        timeInForce: 'GTC'
      };
      const orderExample2 = {
        symbol: candidate.buy2.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: priceBuy2,
        quantity: balance,
        timeInForce: 'GTC'
      };
      const orderExample3 = {
        symbol: candidate.sell1.symbol,
        side: 'SELL',
        type: 'LIMIT',
        price: priceSell1,
        quantity: balance,
        timeInForce: 'GTC'
      };
      try {
        const [order1, order2, order3] = await Promise.all([
          await client.newOrder(orderExample1.symbol, orderExample1.side, orderExample1.type, {
            price: orderExample1.price.toString(),
            quantity: parseInt(orderExample1.quantity),
            timeInForce: 'GTC'
          }),
          await client.newOrder(orderExample2.symbol, orderExample2.side, orderExample2.type, {
            price: orderExample2.price.toString(),
            quantity: parseInt(orderExample2.quantity),
            timeInForce: 'GTC'
          }),
          await client.newOrder(orderExample3.symbol, orderExample3.side, orderExample3.type, {
            price: orderExample3.price.toString(),
            quantity: parseInt(orderExample3.quantity),
            timeInForce: 'GTC'
          }),
        ]);
        bot.telegram.sendMessage(process.env.CHAT_ID, JSON.stringify({
          order1, order2, order3,
          date: new Date()
        }));
      } catch (error) {
        console.log({
          error: error.response
        })
        bot.telegram.sendMessage(process.env.CHAT_ID, JSON.stringify({
          error,
          date: new Date()
        }));
      }

      bot.telegram.sendMessage(process.env.CHAT_ID, `
      BUY BUY SELL - ${candidate.buy1.symbol} > ${candidate.buy2.symbol} > ${candidate.sell1.symbol}
      INVEST: ${AMOUNT} - ${QUOTE}
      RETURN: ${((AMOUNT / priceBuy1) / priceBuy2) * priceSell1} - ${QUOTE}`);
    }
  }
}

async function processBuySellSell(buySellSell, balance) {
  for (let i = 0; i < buySellSell.length; i++) {
    const candidate = buySellSell[i];

    //verifica se já temos todos os preços
    let priceBuy1 = stream.getBook(candidate.buy1.symbol);
    if (!priceBuy1) continue;
    priceBuy1 = parseFloat(priceBuy1.price);

    let priceSell1 = stream.getBook(candidate.sell1.symbol);
    if (!priceSell1) continue;
    priceSell1 = parseFloat(priceSell1.price);

    let priceSell2 = stream.getBook(candidate.sell2.symbol);
    if (!priceSell2) continue;
    priceSell2 = parseFloat(priceSell2.price);

    //se tem o preço dos 3, pode analisar a lucratividade
    const crossRate = (1 / priceBuy1) * priceSell1 * priceSell2;
    if (crossRate > PROFITABILITY) {
      const orderExample1 = {
        symbol: candidate.buy1.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: priceBuy1,
        quantity: balance,
        timeInForce: 'GTC'
      };
      const orderExample2 = {
        symbol: candidate.sell1.symbol,
        side: 'SELL',
        type: 'LIMIT',
        price: priceSell1,
        quantity: balance,
        timeInForce: 'GTC'
      };
      const orderExample3 = {
        symbol: candidate.sell2.symbol,
        side: 'SELL',
        type: 'LIMIT',
        price: priceSell2,
        quantity: balance,
        timeInForce: 'GTC'
      };
      try {
        const [order1, order2, order3] = await Promise.all([
          await client.newOrder(orderExample1.symbol, orderExample1.side, orderExample1.type, {
            price: orderExample1.price.toString(),
            quantity: parseInt(orderExample1.quantity),
            timeInForce: 'GTC'
          }),
          await client.newOrder(orderExample2.symbol, orderExample2.side, orderExample2.type, {
            price: orderExample2.price.toString(),
            quantity: parseInt(orderExample2.quantity),
            timeInForce: 'GTC'
          }),
          await client.newOrder(orderExample3.symbol, orderExample3.side, orderExample3.type, {
            price: orderExample3.price.toString(),
            quantity: parseInt(orderExample3.quantity),
            timeInForce: 'GTC'
          }),
        ]);
        bot.telegram.sendMessage(process.env.CHAT_ID, JSON.stringify({
          order1, order2, order3,
          date: new Date()
        }));
      } catch (error) {
        console.log({
          error: error.response
        })
        bot.telegram.sendMessage(process.env.CHAT_ID, JSON.stringify({
          error,
          date: new Date()
        }));
      }

      bot.telegram.sendMessage(process.env.CHAT_ID, `
      BUY SELL SELL - ${candidate.buy1.symbol} > ${candidate.sell1.symbol} > ${candidate.sell2.symbol}
      INVEST: ${QUOTE}${AMOUNT}
      RETURN: ${QUOTE}${((AMOUNT / priceBuy1) * priceSell1) * priceSell2}
      `);
    }
  }
}

async function start() {

  const { data } = await client.account();
  const balance = data?.balances.filter(f => f.asset === QUOTE).map(b => b.free);
  info(`Your balance in ${QUOTE} is: `, balance);

  //pega todas moedas que estão sendo negociadas
  log('Loading Exchange Info...');
  const allSymbols = await exchangeInfo();

  //moedas que você pode comprar
  const buySymbols = allSymbols.filter(s => s.quote === QUOTE);
  log('There are ' + buySymbols.length + " pairs that you can buy with " + QUOTE);

  //organiza em map para performance
  const symbolsMap = getSymbolMap(allSymbols);

  //descobre todos os pares que podem triangular BUY-BUY-SELL
  const buyBuySell = getBuyBuySell(buySymbols, allSymbols, symbolsMap);
  log('There are ' + buyBuySell.length + " pairs that we can do BBS");

  //descobre todos os pares que podem triangular BUY-SELL-SELL
  const buySellSell = getBuySellSell(buySymbols, allSymbols, symbolsMap);
  log('There are ' + buySellSell.length + " pairs that we can do BSS");

  setInterval(async () => {
    log(new Date());
    processBuyBuySell(buyBuySell, balance);
    processBuySellSell(buySellSell, balance);
  }, CRAWLER_INTERVAL)
}
start();