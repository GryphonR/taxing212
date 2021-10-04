// for (tradeKey in holding.ledger) {
var i;
for (i = holding.ledger.length - 1; i >= 0; i--) { //Step through Ledger in reverse
    var l = holding.ledger[i];
    console.log(JSON.stringify(l));

    //is it a disposal?
    if (l.change < 0) { //if change is negative it's a sell.
        console.log(`Sold Something`);
    }

    // Step through trades in chronological order and calculate gains per disposal
    console.log(`Trade Type = ${t.rawType}`);
    if (t.rawType == "Buy") {
        console.log(`Bought ${holding.ticker}`);
        //Check if first buy since low holdings
        if (holdings < 0.1) { // TAking into account a closed position with some stock dust left over - i.e. non zero but negligable balance
            firstBuyDate = t.timestamp;
        }
        holdings += t.number;
        costBasis += t.total;
        averagePrice = (holding / costBasis);
        lastBuy.cost = t.total;
        lastBuy.date = t.timestamp;
        lastBuy.amount = t.number;
    } else { //sell
        console.log(`Disposal:sell`);
        // todo - check that more have been bought than sold. i.e. is history complete?
        //Is this a BnB(30day) trade?
        let thirtyDaysMs = 2592000000; //1000*60*60*24*30;
        if (t.timestamp - lastBuy.date > thirtyDaysMs) { //This is a BnB desposal
            console.log(`BnB Disposal`);
            console.log(`Bought ${lastBuy.ammount} on ${lastBuy.date}`);
            console.log(`Sold ${t.number} on ${t.timestamp}`);
            if (t.number <= lastBuy.amount) { //Sold as much as or less than bnb purchase
                pl = (lastBuy.amount * lastBuy.cost) - (t.number * t.price);
                tempDateBought = lastBuy.date;
            } else { //Part of the trade is counted as bnb, part as average cost
                console.log(`Part BnB Disposal`);
                let outstanding = t.total - lastBuy.amount;
                let temppl = lastBuy.amount * lastBuy.cost - t.number - t.total
                pl = temppl + ((outstanding * t.price) - (outstanding * averagePrice))
            }
        } else { //use cost average
            console.log(`Average Pool Disposal`);
            console.log(`${t.number},${t.price},${t.number}, ${averagePrice}`);
            pl = ((t.number * t.price) - (t.number * averagePrice))
        }
        console.log(`P/L = ${pl}`);
        console.log(`${holding.ticker} PL Calculated as ${pl}`);
        holding.realisedPl += pl;
        disposal = {
            dateSold: t.timestamp,
            dateBought: tempDateBought, //// TODO:
            cost: 0,
            pl: pl,
            calculationMethod: ""
        }

        holding.disposals.push(disposal);