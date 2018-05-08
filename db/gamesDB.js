const db = require('../db');

class GamesDB {

    constructor () {
        
    }

    // *****************************
    //
    //      Private Functions
    //
    // *****************************

    __dbCreateNewGameRecord(userId, gameIdCallback, dbx = db) {
        const sqlGetUserRecord = `SELECT id FROM users WHERE id=($1);`;

        const sqlCreateGame =  `INSERT INTO games 
                                (active, turn) 
                                VALUES 
                                ('idle', 'white') 
                                RETURNING id;`;

        if (isNaN(userId)) return false;

        dbx.one(sqlGetUserRecord, [userId])
            .then(userRecord => {
                if (userRecord.id != userId) {
                    if ((typeof gameIdCallback === 'function')) {
                        gameIdCallback(-1);
                    }
                } else {
                    dbx.one(sqlCreateGame)
                        .then(newGameRecord => {
                            if ((typeof gameIdCallback === 'function')) {
                                gameIdCallback(newGameRecord.id);
                            }
                        })
                }
            })
            .catch(error => {
                console.log(error);
            });
    }

    __dbCreateNewGameUsersRecord(gameId, userId, gameIdCallback, dbx = db) {
        const sqlCreateGameUser = ` INSERT INTO game_users
                                    (gameid, userid)
                                    VALUES
                                    ($1, $2);`;

        dbx.none(sqlCreateGameUser, [gameId, userId])
            .then(() => {
                if ((typeof gameIdCallback) === 'function') {
                    gameIdCallback(gameId);
                }
            })
            .catch(error => {
                console.log(error);
            });
    }

    __dbCreateAllNewGamePiecesRecords(gameId, gameIdCallback, dbx = db) {
        dbx.tx(t1 => {
            const sqlGetPieceId = `SELECT id FROM pieces WHERE name=($1) AND faction=($2);`;

            const sqlCreateGamePiece = `INSERT INTO game_pieces
                                        (gameid, pieceid, coordinate_x, coordinate_y, alive)
                                        VALUES
                                        ($1, $2, $3, $4, $5);`;

            const transactions = [];

            const specialPieces = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
            const armyDetails   = [ {faction: "white", pawnRowNum: '2', specialRowNum: '1'},
                                    {faction: "black", pawnRowNum: '7', specialRowNum: '8'}  ];

            for (let adx = 0; adx < armyDetails.length; adx++) {
                for (let sdx = 0; sdx < specialPieces.length; sdx++) {
                    const alphaRow      = String.fromCharCode(97 + sdx);
                    const faction       = armyDetails[adx].faction;
                    const pawnRowNum    = armyDetails[adx].pawnRowNum;
                    const specialRowNum = armyDetails[adx].specialRowNum;
    
                    transactions.push(
                        t1.one(sqlGetPieceId, ['pawn', faction])
                            .then(pieceRecord => {
                                const pieceId = pieceRecord['id'];
                                return t1.any(sqlCreateGamePiece, [gameId, pieceId, alphaRow, pawnRowNum, true])
                            })
                        ,
                        t1.one(sqlGetPieceId, [specialPieces[sdx], faction])
                            .then(pieceRecord => {
                                const pieceId = pieceRecord['id'];return t1.any(sqlCreateGamePiece, [gameId, pieceId, alphaRow, specialRowNum, true])
                            })
                        );
                }
            }
            
            return t1.batch(transactions);
        })
        .then(() => {
            if ((typeof gameIdCallback) === 'function') {
                gameIdCallback(gameId);
            }
        })
        .catch(error => {
            console.log(error);
        });
    }

    __dbSetUserGamePiecesRecords(gameId, userId, faction, gameIdCallback, dbx = db) {
        const sqlGetPieceRecordsByFaction = `SELECT id FROM pieces WHERE faction=($1)`; 

        const sqlSetSqlGamePieces = `UPDATE game_pieces
                                     SET userid=($1)
                                     WHERE pieceid=($2) AND gameid=($3)`              

        dbx.tx(t1 => {
            const transactions = [];

            transactions.push(
                t1.any(sqlGetPieceRecordsByFaction, [faction])
                    .then(pieceRecords => {
                        for (let idx = 0; idx < pieceRecords.length; idx++) {
                            const pieceRecord = pieceRecords[idx];
                            const pieceId = pieceRecord.id;
                            t1.none(sqlSetSqlGamePieces, [userId, pieceId, gameId])
                        }
                    })
            )

            return t1.batch(transactions);
        })
        .then(() => {
            if ((typeof gameIdCallback) === 'function') {
                gameIdCallback(gameId);
            }
        })
        .catch(error => {
            console.log(error);
        })
    }

    // *****************************
    //
    //      Public Functions
    //
    // *****************************

    /**
     * Creates the appropriate records within the database for a new game.
     * @param {Number} userId The host's ID to attach to the newly created game record.
     * @param {String} faction The faction of this user.
     * @param {Function} gameIdCallback Callback function to return the ID of the newly created game record.
     */
    createNewGame(userId, faction, gameIdCallback) {
        this.__dbCreateNewGameRecord(userId, (gameId => {
            this.__dbCreateNewGameUsersRecord(gameId, userId, (gameId => {
                this.__dbCreateAllNewGamePiecesRecords(gameId, (gameId) => {
                    this.__dbSetUserGamePiecesRecords(gameId, userId, faction, gameIdCallback);
                })
            }))
        }))    
    }

    /**
     * Retrieve all game_pieces and pieces records by joining them together as a single array. The
     * conditions are that the game_pieces must be alive and belong to a given game ID.
     * @param {Number} gameId The game ID to identify the all the records in the game_pieces table.
     * @param {Function} callbackFunction The callback function to return the game_piece records to.
     * @param {Object} dbx The database object to query the tables from. This is optional in case of transaction usage.
     */
    getAliveGamePiecesFrom(gameId, callbackFunction, dbx = db) {
        const sqlGetJoinPieces =   `SELECT * FROM game_pieces 
                                    FULL OUTER JOIN pieces 
                                    ON game_pieces.pieceid=pieces.id
                                    WHERE game_pieces.gameid=($1) AND game_pieces.alive=($2);`

        dbx.any(sqlGetJoinPieces, [gameId, true])
            .then(joinedPieceRecords => {
                callbackFunction(joinedPieceRecords);
            })
            .catch(error => {
                console.log(error);
            });
    }
   
    /**
     * Retrieve all the records from the pieces table.
     * @param {Function} callbackFunction The function to return the retrieved pieces array data to.
     * @param {*} dbx Optional database object for the use of transactions.
     */
    getAllPieces(callbackFunction, dbx = db) {
        const sqlGetAllPieces = `SELECT * FROM pieces;`;

        dbx.any(sqlGetAllPieces)
            .then(pieceRecords => {
                callbackFunction(pieceRecords);
            })
            .catch(error => {
                console.log(error);
            })
    }

    /**
     * Set the active state for a specific game.
     * @param {*} gameId The ID referring to a specific game.
     * @param {*} activeState The active state to set a game to. The options are {'active' , 'idle', 'not_active'}
     * @param {*} callbackFunction The callback function to call after execution; there is no data returned.
     * @param {*} dbx Optional database object for the use of transactions. 
     */
    setGameActiveState(gameId, activeState, callbackFunction, dbx = db) {
        const sqlSetGameState = `UPDATE games
                                 SET active=($1)
                                 WHERE id=($2);`;

        dbx.any(sqlSetGameState, [activeState, gameId])
            .then(() => {
                callbackFunction();
            })
            .catch(error => {
                console.log(error);
            })
    }

    /**
     * Set the opponent of the specific game in the database.
     * @param {*} gameId The ID of the game of which to modify the opponent ID value of.
     * @param {*} opponentId The ID of the opponent for a the given game.
     * @param {*} callbackFunction The callback function to call after execution; no data is given.
     * @param {*} dbx Optional database object for the use of transactions.
     */
    setGameOpponent(gameId, opponentId, callbackFunction, dbx = db) {
        const sqlSetOpponent = `UPDATE game_users
                                SET opponentid=($1)
                                WHERE gameid=(2);`;

        dbx.any(sqlSetOpponent, [opponentId, gameId])
            .then(() => {
                callbackFunction();
            })
            .catch(error => {
                console.log(error);
            })
    }

}

module.exports = GamesDB;