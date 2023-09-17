const httpServer = require("http").createServer();
const uuid = require('uuid');
const ShortUniqueId = require('short-unique-id');


const io = require('socket.io')(httpServer, {
  cors: {
    origins: ['http://localhost:8080'],
  },
});

const PORT = process.env.PORT || 3000;
const rooms = {};

const { InMemorySessionStore } = require("./sessionStore");
const sessionStore = new InMemorySessionStore();

const ROLES =  [
  "Imposteur",
  "Droide",
  "Mage"
];


/**
 * Will connect a socket to a specified room
 * @param socket A connected socket.io socket
 * @param room An object that represents a room from the `rooms` instance variable object
 */
 const joinRoom = (pseudo, socket, room) => {

  let player = {
    socket : socket,
    pseudo : pseudo
  };

  room.players.push(player);
  socket.join(room.id);
  socket.roomId = room.id;
  console.log(socket.id, "Joined", room.code);

  sessionStore.saveSession(socket.sessionID, {
    id: socket.id,
    roomId  : socket.roomId,
    username: socket.username,
    connected: true,
  });

};

const gameState = (room) => {

  const output = {
    code    : room.code, 
    players : room.players.map((elt) => elt.pseudo),
    state   : room.state
  }
  console.log(output);

  return output;
}


/**
 * Will make the socket leave any rooms that it is a part of
 * @param socket A connected socket.io socket
 */
 const leaveRooms = (socket) => {
  const roomsToDelete = [];
  for (const id in rooms) {
    const room = rooms[id];
    console.log("ask to delete room");
    // check to see if the socket is in the current room
    console.log(room.players);
    if (room.players.map((elt) => elt.socket.id).includes(socket.id)) {
      console.log("player is in a room");
      socket.leave(id);
      // remove the socket from the room object
      room.players = room.players.filter((item) => item.socket.id != socket.id);
      socket.emit("leaveRoom");
      socket.broadcast.to(room.id).emit("updateRoom",gameState(room));
    }
    // Prepare to delete any rooms that are now empty
    if (room.players.length == 0) {
      roomsToDelete.push(room);
    }
  }


  // Delete all the empty rooms that we found earlier
  for (const room of roomsToDelete) {
    delete rooms[room.id];
  }
};

io.use( async (socket, next) => {

  const sessionID = socket.handshake.auth.sessionID;
  if (sessionID) {
    console.log("session provided : "+ sessionID );
    const session = await sessionStore.findSession(sessionID);
    if (session) {
      console.log("session exist with id : " + sessionID);
      console.log(session);
      socket.sessionID = sessionID;
      socket.id = session.id;
      socket.roomId = session.roomId
      socket.username = session.username;
      return next();
    }else{
      socket.emit("session_expired");
      return next();
    }
  }

  console.log("session not exist");
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error("invalid username"));
  }
  socket.sessionID = uuid.v1();
  socket.id = uuid.v1();
  socket.username = username;
  next();
});

io.of("/").adapter.on("join-room", (room, id) => {
  console.log(`socket ${id} has joined room ${room}`);
});

io.on('connection', (socket) => {
  console.log('player connected' + socket.id);

  sessionStore.saveSession(socket.sessionID, {
    id: socket.id,
    username: socket.username,
    roomId  : socket.roomId,
    connected: true,
  });

  
  socket.emit("session", {
    sessionID: socket.sessionID,
    id: socket.id,
  });

  console.log(socket.roomId  + "id de la room");
  const room = rooms[socket.roomId];

  if ( room != null){
    socket.join(socket.roomId);
    socket.emit("updateRoom",gameState(room));
  }
 /**
   * The game has started! Give everyone their default values and tell each client
   * about each player
   * @param data we don't actually use that so we can ignore it.
   * @param callback Respond back to the message with information about the game state
   */
  socket.on('startGame', async (data, callback) => {
    const room = rooms[socket.roomId];
    if (!room || socket.id != room.owner) {
      return;
    }

    const nb_player = room.players.length;

    if(nb_player < 2){
      socket.emit("startGameFailed",`Impossible de créer la partie il n'y a actuellement que ${nb_player} joueur`);
      return;
    }

    const output = {};
    room.state = 1;

    for (const client in room.players) {
      const role = ROLES[Math.floor(Math.random()*ROLES.length)]
      client.role = role

      output[client.id] = {
        role: role
      };

      if (client === socket) {
        continue;
      }
    }

    // Start the game in 3 seconds
    setTimeout(() => {
      room.startedAt = Date.now();
      
      for (const client of room.players) {
        io.to(room.id).emit("startGame",gameState(room));
        // setInterval(() => {
        //   client.emit('mission',{ "message" : "Do it !"});
        // },10000);
      } 
    }, 3000);
  });


  /**
   * Gets fired when a user wants to create a new room.
   */
  socket.on('createRoom',  (pseudo) => {
    const generator = new ShortUniqueId({ dictionary: 'hex' });
    const code = generator();
    console.log("create a room with code : " + code);

    for (const id in rooms) {
      const room = rooms[id];
      // check to see if the socket is already in a room
      if (room.players.map((elt) => elt.socket.id).includes(socket.id)) {
        socket.emit("joinRoomFailed","player already in a room " + room.code);
        return;
      }
    }

    const room = {
      id: uuid.v1(), // generate a unique id for the new room, that way we don't need to deal with duplicates.
      code : code,
      players: [],
      state  : 0,
      owner  : socket.id,
      create_at : Date.now(),
      started_at : null
    };


    rooms[room.id] = room;
    // have the socket join the room they've just created.
    joinRoom(pseudo, socket, room);
    socket.emit("createRoomSuccess",gameState(room));
    socket.emit("updateRoom",gameState(room));
  });

  /**
   * Gets fired when a player has joined a room.
   */
  socket.on('joinRoom', async ({pseudo, roomCode}) => {

    console.log("try to join a room with code :" + roomCode + " and pseudo" + pseudo);

    for (const id in rooms) {
      const room = rooms[id];
      // check to see if the socket have already join a room
      if (room.players.map((elt) => elt.socket.id).includes(socket.id)) {
        socket.emit("joinRoomFailed","player already in a room");
      }
    }

    
    Object.entries(rooms).forEach(([key,value]) => {
      const room = value;
      if ( room.code == roomCode && room.players.length < 5){
        joinRoom(pseudo, socket, room );
        const output = gameState(room);
        io.to(room.id).emit("updateRoom",gameState(room));
      }else{
        console.log("user failed to join the room");
        socket.emit("joinRoomFailed","room code invalid or room is full");
      }
    });
  });

   /**
   * Gets fired when a player leaves a room.
   */
    socket.on('leaveRoom', () => {
      leaveRooms(socket);
      
    });

    
  /**
   * Gets fired when a player disconnects from the server.
   */
  socket.on('disconnect', () => {
    console.log('user disconnected');
   // leaveRooms(socket);
    sessionStore.saveSession(socket.sessionID, {
      id: socket.id,
      roomId  : socket.roomId,
      username: socket.username,
      connected: false,
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`server listening on localhost:${PORT}`);
});