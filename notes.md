What do I want from a social networking library?


Easy drop-in

API

	join room by id
	see all users in room
	boot users
	broadcast to room 
	dm a user
	leave room
	on host exit, designate new host

	event log

	Use peerjs if possible
	Failover to Firebase
	
3/12
Create an event log to store all state events
(additional flow events, ie, movements, may be stored separately)

https://martinfowler.com/eaaDev/EventSourcing.html

-----------------
3/25

MVP:
I can get instant student suggestions and answers
I can track student participation
Match student handles with canvas IDs (for grading)

Event documentation for Social
Track logins?


Checkin:
host can post prompt
clients can post answers
host can display client answers