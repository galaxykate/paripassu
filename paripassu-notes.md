A party is made of

Affordances (Dourish)
Permission and invitation to play games (DeKoven)
Worlds of our imagination (DeKoven, Koster)
Spaces made of districts, landmarks, nodes, boundaries, and paths (Lynch)
Spaces that provide prospect and refuge (Hildebrand)
How we present ourselves, and the masks we wear (Goffman, Johnstone)
Multiple channels of communication (Compton)
Communication through words and gestures (Gawne)
Cheeseplates that give us something to talk about (McCulloch, Lazerwalker)
Groups building meaning together around shared events (Blaseball, Wordle, r/place, Bogost)
A list of events (Lu, Fowler)
Social structures like economies, guilds, friend groups (Project Horseshoe, Koster)
Bodies with holdable, wearable, habitable objects (EleVR)


Everything is done in radians (we convert them to degrees for AFrame)


noise goes from [0,1]
obj.f.addSpherical(move, 10*noise(.1*t + i), 0, 'y')
obj.v.addScaledVector(obj.f, .1)

obj.position.addScaledVector(obj.v, .1)
obj.lookAlong(obj.v)
obj.v.multiplyScalar(.8)


# LiveObjects

Removing Vector class in favor of extending Object3D and Vector3 from THREE
(except keeping it for colors)

### Networking
On creation, send "created" message
LiveObjects that share a uid will all be synced
If you create a LiveObject without a UID, a unique one will be created.
So if you want all users to have a copy of the campfire, 

LiveObject extends Object3D and will broadcast itself to the room
* TODO test liveobject updates only on need
* Subscribe to liveobjects
* isTracked on liveobject
* trackedKeys const trackedKeys = ["size", "color", "fireStrength", "rotation", "position", "paritype"]
* params: http://[::]:8000/?mirrorself=1&name=kate


LiveObject
	lookAt(v)
	lookAlong(v)


Three kinds of objects:
* Tracked objects: visible to all of us, have to stay in sync
* Blaseball/Wordle(?) objects: we each have our own copy. They stay in sync because their behavior is driven by time on a fixed progression (ie, scripted or using noise)
* Personal objects: visible only to the local user, may be generated differently for each user

User enters a room....
	...if they are the first, add any shared tracked objects
	otherwise, add any self-visible objects


# Recipe book

LiveObjects
If you don't need to track the object
```
let box = new LiveObject(undefined, { 
	color: new Vector(Math.random()*360, 100, 50)
})
```
If you do need to track the object, include a room
```
let box = new LiveObject(undefined, { 
	color: new Vector(Math.random()*360, 100, 50)
})
```

Random color: 
`let c = new Vector(Math.random()*360, 100, 50)`

```
let c = new Vector(Math.random()*360, 100, 50)
...
<!-- lighter box -->
<a-box :color="c.toHex(.5)"></a-box>
<!-- darker box -->
<a-box :color="c.toHex(-.5)"></a-box>

```


# Places to put geometry

Scene geometry you don't care about tracking at all 
v-customobjects


# To track an object
