const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const url = require('url');

const app = express();
const port = 5000;
const dbURL = "mongodb+srv://test-user:9pmeJjRNqtysbXZF@testcluster.lcqmg.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";
const { Schema } = mongoose;

let pokemonSchema;
let pokemonModel;

function getMongooseErrorMessage(err, req) {
    if (err.code == 11000) {
        console.log(err);
        return {msg: `Pokemon with id ${req.body.id} already exists`};
    } else {
        console.log(err);
        return {msg: err.message};
    }
}

app.listen(process.env.PORT || 5000, async () => {
    try {
        await mongoose.connect(dbURL);
    } catch (error) {
        console.log('db error');
    }
    console.log(`App listening on port ${port}`);

    let possibleTypes = [];

    await https.get("https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/types.json", async (res) => {
        let rawData = "";
        await res.on("data", (chunk) => {
            rawData += chunk;
        })
        await res.on("end", () => {
            let parsedData = JSON.parse(rawData);
            parsedData.map(element => possibleTypes.push(element.english));
            pokemonSchema = new Schema({
                "id": {
                    type: Number,
                    unique: true,
                    required: true,
                },
                "name": {
                    type: {
                        "english": {
                            type: String,
                            maxLength: 20,
                            required: true
                        },
                        "japanese": String,
                        "chinese": String,
                        "french": String
                    },
                    required: true,
                    default: {},
                    _id: false
                },
                "base": {
                    type: {
                        "HP": {type: Number, required: true},
                        "Attack": {type: Number, required: true},
                        "Defense": {type: Number, required: true},
                        "Sp Attack": {type: Number, required: true},
                        "Sp Defense": {type: Number, required: true},
                        "Speed": {type: Number, required: true}
                    },
                    required: true,
                    default: {},
                    _id: false
                },
                "type":  {
                    type: [String],
                    enum: possibleTypes,
                    required: true,
                    default: []
                }
            });
            pokemonModel = mongoose.model('pokemon', pokemonSchema);
        })
    })

    function renameSpecialStats(obj) {
        obj["base"]["Sp Attack"] = obj["base"]["Sp. Attack"];
        delete obj["base"]["Sp. Attack"];
        obj["base"]["Sp Defense"] = obj["base"]["Sp. Defense"] ;
        delete obj["base"]["Sp. Defense"];
    }

    await https.get("https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/pokedex.json", async (res) => {
        let rawData = "";
        res.on("data", (chunk) => {
            rawData += chunk;
        })
        res.on("end", async () => {
            let parsedJSON = JSON.parse(rawData);
            parsedJSON.forEach(obj => renameSpecialStats(obj));
            await pokemonModel.collection.drop();
            await pokemonModel.collection.createIndex({id: 1}, {unique: true});
            await pokemonModel.insertMany(parsedJSON);
            console.log("Populated pokemons collection.")
        })
    })
})

app.get('/api/v1/pokemonsAdvancedFiltering/', (req, res) => {

    const parsedQueryParams = {
        "id": req.query.id,
        "name": {
            "english": req.query["name.english"],
            "japanese": req.query["name.japanese"],
            "chinese": req.query["name.chinese"],
            "french": req.query["name.french"]
        },
        "base.HP": req.query["base.HP"],
        "base.Attack": req.query["base.Attack"],
        "base.Defense": req.query["base.Defense"],
        "base.Sp Attack": req.query["base.Sp Attack"],
        "base.Sp Defense": req.query["base.Sp Defense"],
        "base.Speed": req.query["base.Speed"]
    }

    if (req.query.type) {
        const typeArray = req.query.type.replace(/\s/g,'').split(",")
        parsedQueryParams["type"] = {
            "$in": typeArray
        }
    }

    function deleteUndefinedKeysRecursive(obj) {
        Object.keys(obj).forEach(key => {
            if(typeof obj[key] === "object") {
                deleteUndefinedKeysRecursive(obj[key]);
                if(Object.keys(obj[key]).length === 0) {
                    delete obj[key];
                }
            }
            if (obj[key] === undefined) {
                delete obj[key];
            }
        })
    }

    deleteUndefinedKeysRecursive(parsedQueryParams);

    console.log(parsedQueryParams);

    let filteredPropertySelect = { _id: 0 };
    if (req.query.filteredProperty) {
        const filterArray = req.query.filteredProperty.split(",");
        console.log(filterArray);
        filterArray.forEach(element => {
            element = element.trim();
            filteredPropertySelect[element] = 1;
        })
    }
    console.log(filteredPropertySelect);

    let sortSelect = {};
    if (req.query.sort) {
        const sortArray = req.query.sort.split(",");
        sortArray.forEach(element => {
            element = element.trim();
            if (element.charAt(0) === '-') {
                sortSelect[element.substring(1)] = -1;
            } else {
                sortSelect[element] = 1;
            }
        })
    }

    let responseObject = {};

    const page = req.query.page ? req.query.page : "1";
    const hitsPerPage = req.query.hitsPerPage ? req.query.hitsPerPage : "5";
    const itemsAfterPage = (parseInt(page) - 1) * parseInt(hitsPerPage)

    pokemonModel.find(parsedQueryParams).select(filteredPropertySelect).sort(sortSelect).exec((err, doc) => {
        if (err) {
            res.json(getMongooseErrorMessage(err, doc));
        } else {
            responseObject["hits"] = doc.slice(itemsAfterPage, itemsAfterPage + hitsPerPage);
            responseObject["page"] = page;
            responseObject["nbHits"] = doc.length;
            responseObject["nbPages"] = Math.ceil(doc.length / hitsPerPage);
            responseObject["hitsPerPage"] = hitsPerPage;
            responseObject["query"] = parsedQueryParams;
            if (url.parse(req.url).search) {
                responseObject["params"] = url.parse(req.url).search.substring(1);
            } else {
                responseObject["params"] = ""
            }
            res.json(responseObject);
        }
    });

})

app.get('/api/v1/pokemons', (req, res) => { // - get all the pokemons after the 10th. List only Two.
    function isNumber(n) { return !isNaN(parseFloat(n)) && !isNaN(n - 0) }

    if ((req.query.after && !isNumber(req.query.after)) || (req.query.count && !isNumber(req.query.count))) {
        res.json({msg: `after = ${req.query.after}, count = ${req.query.count}; after and count query parameters must be numbers`});
        return;
    }

    pokemonModel.find().skip(req.query.after).limit(req.query.count).exec((err, result) => {
        if (err) {
            res.json(getMongooseErrorMessage(err, req));
        } else {
            res.json(result);
        }
    })
})

app.post('/api/v1/pokemon', bodyParser.json(), (req, res) => { // - create a new pokemon
    console.log(req.body);
    pokemonModel.create(req.body, (err, opRes) => {
        if (err) {
            res.json(getMongooseErrorMessage(err, req));
        } else {
            console.log(opRes);
            res.json({msg: "Successfully inserted new pokemon"});
        }
    })
})

app.get('/api/v1/pokemon/:id', (req, res) => { // - get a pokemon
    console.log(req.params.id);
    pokemonModel.find({ id: req.params.id }, (err, doc) => {
        if (err) {
            console.error(err)
            res.json({msg: "db reading .. err.  Check with server devs"})
        } else if (doc.length === 0){
            console.log(doc);
            res.json({msg: `Pokemon with id ${req.params.id} does not exists`});
        } else {
            console.log(doc);
            res.json(doc);
        }
    })
})

app.get('/api/v1/pokemonImage/:id', async (req, res) => { // - get the url of a pokemon
    function idToThreeDigitString(id) {
        if (Math.floor(id / 10) >= 10) {
            return id.toString();
        } else if (Math.floor(id / 10) > 1) {
            return "0" + id.toString();
        } else {
            return "00" + id.toString();
        }
    }
    res.json({
        url: "https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/images/"
            + idToThreeDigitString(req.params.id) + ".png"
    })
})

app.put('/api/v1/pokemon/:id', bodyParser.json(), (req, res) => { // - upsert a whole pokemon document
    pokemonModel.updateOne({ id: req.params.id }, req.body, { upsert: true, runValidators: true, new: true }, (err, opRes) => {
        if (err) res.json(getMongooseErrorMessage(err, req));
        else if (opRes.upsertedCount > 0) {
            res.json({msg: `Couldn't find pokemon with id ${req.params.id}; inserted new pokemon instead`})
        }
        else {
            console.log(opRes);
            res.json({msg: `Successfully updated pokemon with id ${req.params.id}`})
        }
    });
})

app.patch('/api/v1/pokemon/:id', bodyParser.json(), (req, res) => { // - patch a pokemon document or a portion of the pokemon document
    console.log(req.body);
    pokemonModel.updateOne({ id: req.params.id }, req.body, { runValidators: true }, (err, opRes) => {
        if (err) res.json(getMongooseErrorMessage(err, req));
        else if (opRes.modifiedCount > 0) {
            res.json({msg: `Successfully patched pokemon with id ${req.params.id}`})
        }
        else {
            res.json({msg: `Patch failed. Pokemon with id ${req.params.id} does not exist`})
        }
    })
})

app.delete('/api/v1/pokemon/:id', (req, res) => { // - delete a  pokemon
    pokemonModel.deleteOne({ id: req.params.id },  (err, opRes) => {
        if (err) {
            console.error(err);
            res.json(getMongooseErrorMessage(err, req));
        } else if (opRes.deletedCount === 0){
            console.log(opRes);
            res.json({msg: `Failed to delete. Pokemon with id ${req.params.id} does not exists`});
        } else {
            console.log(opRes);
            res.json({msg: `Pokemon with id ${req.params.id} successfully deleted`});
        }
    })
})

app.get('/api/doc', (req, res) => {
    res.sendFile(path.join(__dirname, '/docs.html'))
})

app.all('*', (req, res) => {
    res.status(404).json({msg: "Improper request"});
})
