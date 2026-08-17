// ─── THE CITY PLANNING MANIFEST ──────────────────────────────────────────────
// Every deliberate placement in the world, in one editable file. planet.js
// reads THIS — edit a line here, reload, and the thing moves. Rendered as a
// planning map by `node scripts/render-map.mjs` → city_map.png.
//
// Units: `[lat, lon]` in degrees on the planet. `at: [x, y]` entries are local
// tangent-frame offsets (world units) inside the named frame. Distances/sizes
// are world units (a car ≈ 2 long, a person ≈ 1 tall).
export default {

  // ── planet anchors: the bones of the map ──
  anchors: {
    downtown: [20, -36],       // city plateau centre — everything grid-ish hangs off this
    lake:     [-40, 62],       // the bay (boat fallback moor)
    mountain: [55, -50],       // the overlook mountain
    airport:  [55, 80],        // runway district, well out of town
    mall:     [9, -48],
    farmA:    [46, -12],
    farmB:    [-34, -46],
    resort:   [-14, -66],      // the hotel the arrival limo drives to
    beach:    [-16, -60],      // bay, dock, moored boats
  },

  // ── route stops: train stations + walkable waypoints ──
  stops: {
    central:   [12, 4],        // Central Station (the walk-through GLB station)
    lakeside:  [-26, 58],
    farside:   [6, -168],
    museumst:  [18, -74],
    overlook:  [44, -46],
    boardwalk: [-9, -38],
  },

  // ── project landmarks: the monumental buildings (position only — name,
  //    colour, links stay in planet.js's LANDMARKS table) ──
  landmarks: {
    library:      [14, -8],
    yarnflow:     [24, 22],
    inbox:        [2, 46],
    charterscope: [18, 76],
    deckgpt:      [-8, 100],
    council:      [16, 128],
    brainu:       [-2, 156],
    sinescape:    [12, -176],
    pixels:       [-6, -148],
    ros2:         [14, -120],
    artgarden:    [26, -66],   // the Downtown Museum — tonight's main event
  },

  // ── hero assets: the imported GLB set-pieces. `dims: [width, length]` is the
  //    real world-unit footprint (length along the asset's facing axis) — the
  //    planning map draws these to scale so fit problems are visible on paper ──
  heroes: {
    jetParked:    { frame: 'airport', at: [-3.2, 3],  dims: [4.6, 5.0], facing: 'up-runway',
                    note: 'NetJets on the apron, nose up-runway' },
    limoApron:    { frame: 'airport', at: [5.2, 12],  dims: [1.15, 4.6],
                    note: 'limo waits clear of the runway end' },
    gasStation:   { frame: 'spur:downtown→airport', t: 0.5, side: 2.3, scale: 1.7, dims: [6.1, 4.8],
                    note: 'Gas-N-Go halfway down the airport spur; limo pulls onto the slab' },
    trainStation: { frame: 'stop:central', offTrack: -3.0, len: 13.5, lift: 0.32, settleHalf: 3.8,
                    dims: [5.4, 13.5], note: 'walk-through station; long axis along the rails' },
    rocketPad:    { frame: 'stop:farside', side: 0.12, dims: [3.4, 3.4], note: 'shuttle pad' },
    airportTerminal: { frame: 'airport', at: [4.5, 0], dims: [3.0, 7.0], note: 'terminal hall (procedural)' },
  },

  // ── shared references the map draws for scale + fit checks ──
  reference: {
    runway:   { frame: 'airport', from: [0, -18], to: [0, 18], width: 4.8 },
    roadHalf: 1.3,     // spur/highway half-width (car is ~1.5 wide)
    majorW: 2.2,       // painted width of downtown boulevards (blocks are 3-6)
    minorW: 0.9,       // painted width of downtown lanes (blocks are ~3)
    car:      [1.0, 2.1],
    person:   [0.6, 0.6],
    boardRadius: 1.6,  // walk-through boarding trigger at Central Station
    landmarkClear: 4.5, // no generated building/parcel within this of a landmark
    stationClear: 8.0,  // Central Station needs a full block of open ground
  },
};
