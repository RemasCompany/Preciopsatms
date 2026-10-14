// Ready-made courses a company can add with one click and then edit. They are starting points, not legal advice:
// each company should review them with its safety lead and add what's specific to its clients' sites.
import { FORKLIFT_TEMPLATE, type CourseInput } from './training';

const SCISSOR: CourseInput = {
  title: 'Scissor lift operator (MEWP Group A)',
  certType: 'Scissor lift (MEWP Group A)',
  description: 'Operator training for scissor lifts and other Group A mobile elevating work platforms, based on ANSI A92.22 (safe use) and A92.24 (training) and OSHA’s aerial lift and scaffold rules. After the quiz, a qualified person familiarizes the operator with the actual model they’ll use and evaluates them on it. Review this course with your safety lead and add site-specific rules.',
  recertMonths: 36,
  passScore: 80,
  lessons: [
    { title: 'Who may operate a lift', body: 'Only people who have been trained, and familiarized with the specific make and model, may operate a mobile elevating work platform (MEWP). Anyone riding on the platform also needs training on the hazards and how to use the controls in an emergency.\n\nFamiliarization means someone qualified shows you, on that machine, where the manual is kept, the controls and emergency controls, the safety devices, and the rated load and other limits.\n\nYou need retraining before operating again if you are seen operating unsafely, are involved in an accident or near-miss, are assigned to a different type of MEWP, or if something changes on site that affects safe operation.\n\nThis online course is the classroom part. You are not qualified until a trainer evaluates you on the machine.' },
    { title: 'Know your machine', body: 'Scissor lifts are Group A MEWPs: the platform moves straight up and stays inside the machine’s tipping lines. Boom lifts are Group B and need separate training.\n\nThe manufacturer’s manual must stay on the machine, usually in a weatherproof box on the platform. Read it.\n\nThe capacity decal shows the rated load: the total weight of people, tools and materials allowed on the platform, and how many people. Never exceed it.\n\nCheck whether the machine is rated for indoor use only or for outdoor use, and the maximum wind speed it is rated for. Many slab scissor lifts are indoor-only and must not be used in any wind.\n\nKnow the platform controls, the ground (lower) controls, the emergency stop, the emergency lowering system, the tilt alarm and the pothole protection.' },
    { title: 'Before you start: inspection and the work area', body: 'Before each shift, do the pre-start inspection in the manual: guardrails, gate and toe boards; decals and the capacity plate; tires and wheels; hydraulic hoses and cylinders for leaks; batteries and charger; and the scissor arms and pins.\n\nThen do the function tests from both the ground and the platform controls: drive and steer, raise and lower, emergency stop, emergency lowering, the tilt alarm, the horn and the brakes. If anything fails, tag the machine out of service and report it.\n\nCheck the work area: holes, drop-offs, slopes, soft ground, debris, overhead obstructions, pedestrians and vehicle traffic, wind and weather. Stay at least 10 feet away from overhead power lines — farther for higher voltages — and treat every line as energized. Set up barricades or cones if people or vehicles pass by.' },
    { title: 'Operating safely', body: 'Close the gate or entry chain before you raise the platform. Keep both feet on the platform floor. Never sit, stand or climb on the guardrails, and never use ladders, buckets or planks on the platform to reach higher.\n\nOn a scissor lift the guardrails are your fall protection. If the manufacturer or the site requires a harness, attach it only to an anchor point the manufacturer designates on the platform.\n\nOnly drive while raised if the manual allows it, and only on firm, level ground, slowly. Never drive raised near holes, edges or slopes. If the tilt alarm sounds, stop and lower the platform.\n\nDon’t push or pull against anything from the platform, don’t hang loads from the rails, and don’t overload one side. Watch overhead for beams, pipes and ceilings so you are not crushed against them.' },
    { title: 'Hazards: tip-overs, falls, crushing and electricity', body: 'Tip-overs happen when the lift is driven into a hole or off an edge, used on a slope, overloaded, side-loaded, or used in wind above its rating.\n\nFalls happen when people climb the rails, lean out too far, or leave the gate open.\n\nCrushing and entrapment happen between the platform and overhead structures, or at ground level when people stand near the scissor arms or wheels. Keep everyone clear of the arms when lowering.\n\nElectrocution: contact with a power line, or getting too close to one, can kill you even without touching it. Keep your distance and have a spotter when working near lines.' },
    { title: 'Emergencies and rescue', body: 'Know how to use the emergency stop on the platform and at the ground controls, and how to use the emergency lowering system from the ground if the operator can’t lower the platform.\n\nThere must be a rescue plan before work begins. Never work alone without someone on the ground who knows how to lower the platform.\n\nReport every accident, near-miss and malfunction to your supervisor right away.' },
    { title: 'Parking and shutting down', body: 'Lower the platform fully. Park on firm, level ground away from traffic, exits and fire equipment. Turn off the machine, set the brake and remove the key so no one untrained can use it.\n\nCharge batteries only in a ventilated charging area, with no smoking or open flames, as the manual describes.' },
  ],
  questions: [
    { q: 'Before using a scissor lift model you haven’t used before, you need:', choices: ['Nothing if you’ve used any lift before', 'Familiarization on that make and model', 'A driver’s license', 'Permission from a coworker'], answer: 1 },
    { q: 'What does the rated load on the capacity decal include?', choices: ['Only the people', 'Only materials', 'People, tools and materials together', 'Nothing on the platform floor'], answer: 2 },
    { q: 'The lift is rated “indoor use only” and it’s breezy outside. You:', choices: ['Use it outside if you stay low', 'Don’t use it outside', 'Use it if someone holds the base', 'Use it with outriggers'], answer: 1 },
    { q: 'During the function test, the emergency lowering doesn’t work. You:', choices: ['Use it anyway and be careful', 'Tag it out of service and report it', 'Fix it yourself', 'Use only the ground controls'], answer: 1 },
    { q: 'You can’t quite reach the work from the platform. You:', choices: ['Stand on the mid-rail', 'Put a stepladder on the platform', 'Lower, reposition the lift, and raise it again', 'Lean over the top rail'], answer: 2 },
    { q: 'On a scissor lift, what is your main fall protection?', choices: ['A hard hat', 'The guardrails, with the gate closed', 'Holding on to the ceiling', 'Nothing is needed'], answer: 1 },
    { q: 'The tilt alarm sounds while you are raised. You:', choices: ['Keep working quickly', 'Drive to level ground while raised', 'Stop and lower the platform', 'Turn the alarm off'], answer: 2 },
    { q: 'How close may you get to an overhead power line?', choices: ['As close as needed if you don’t touch it', 'No closer than 10 feet, more for higher voltages', '3 feet', 'Power lines are only a problem outdoors in rain'], answer: 1 },
    { q: 'Before the work starts, there must be:', choices: ['A rescue plan and someone on the ground who can lower the platform', 'A second lift nearby', 'Nothing special', 'A ladder against the platform'], answer: 0 },
    { q: 'When you finish for the day you:', choices: ['Leave it raised for tomorrow', 'Lower it fully, turn it off, set the brake and remove the key', 'Leave the key in for the next shift', 'Park it in front of the exit'], answer: 1 },
  ],
  checklist: [
    'Locates the manual and capacity decal; explains the rated load and wind/indoor rating',
    'Completes the pre-start inspection and function tests, including emergency stop and emergency lowering',
    'Assesses the work area: holes, slopes, overhead hazards, power lines, traffic',
    'Closes the gate; keeps both feet on the platform; never climbs the rails',
    'Raises, drives and lowers smoothly and only as the manual allows',
    'Watches overhead to avoid crushing against structures',
    'Demonstrates the emergency stop and the ground emergency lowering procedure',
    'Parks and shuts down correctly: lowered, off, brake set, key removed',
  ],
};

const BOOM: CourseInput = {
  title: 'Boom lift operator (MEWP Group B)',
  certType: 'Boom lift (MEWP Group B)',
  description: 'Operator training for telescopic and articulating boom lifts (Group B mobile elevating work platforms), based on ANSI A92.22/A92.24 and OSHA 1926.453. After the quiz, a qualified person familiarizes the operator with the actual model and evaluates them on it. Review this course with your safety lead and add site-specific rules.',
  recertMonths: 36,
  passScore: 80,
  lessons: [
    { title: 'Who may operate a boom lift', body: 'Only people who have been trained, and familiarized with the specific make and model, may operate a boom lift. Everyone in the platform needs training on the hazards and the emergency controls.\n\nYou need retraining before operating again if you are seen operating unsafely, are involved in an accident or near-miss, are assigned to a different type of lift, or if something changes on site that affects safe operation.\n\nThis online course is the classroom part. You are not qualified until a trainer evaluates you on the machine.' },
    { title: 'Know your machine', body: 'Boom lifts are Group B MEWPs: the platform can reach out past the machine’s tipping lines, so stability depends on the counterweight, the ground and staying within the limits on the decals.\n\nTelescopic booms extend straight out; articulating (knuckle) booms bend so you can reach up and over obstacles. Many have a jib at the end for fine positioning.\n\nThe manual must stay on the machine. The capacity decal shows the rated load (people plus tools and materials) and may show two capacities: a higher one in a restricted range and a lower one at full reach. Know which applies. Check the maximum wind speed rating.\n\nKnow the platform controls, the ground controls, the emergency stop, the auxiliary or emergency lowering, the foot switch (enable pedal) and the tilt alarm.' },
    { title: 'Before you start: inspection and the work area', body: 'Before each shift, do the pre-start inspection: platform, rails and gate; the fall-protection anchor point; decals; tires and wheels; boom, pins and cables; hydraulic leaks; engine or batteries; and the turntable.\n\nDo the function tests from the ground controls and the platform: every boom function, drive and steer, emergency stop, emergency lowering, the foot switch and the tilt alarm. If anything fails, tag the machine out of service and report it.\n\nCheck the work area: ground strength, slopes, holes, drop-offs, overhead obstructions, wind, and people and vehicles below. Stay at least 10 feet from overhead power lines, farther for higher voltages, and treat every line as energized.' },
    { title: 'Fall protection', body: 'In a boom lift you must wear a full-body harness with a lanyard attached to the anchor point the manufacturer provides in the platform. Never tie off to a nearby structure or pole.\n\nUse a lanyard short enough to keep you inside the platform (restraint) unless the manufacturer specifies otherwise.\n\nStand on the platform floor. Never climb or sit on the rails, and never climb out of the platform at height.' },
    { title: 'Operating safely', body: 'Close the gate before moving. Keep the boom lowered and retracted when driving unless the manual allows otherwise, and drive slowly on firm, level ground.\n\nMove the boom smoothly. Before moving the platform, look in the direction of travel — up, down and sideways — so you aren’t crushed against beams, ceilings or structures. Keep your body inside the platform and your hands on the controls, and don’t lean over the controls where you could be pinned.\n\nNever exceed the rated load, use the platform as a crane, or tie the platform to a structure.\n\nIf the tilt alarm sounds, stop and retract the boom toward the machine, following the manual.' },
    { title: 'Emergencies and rescue', body: 'Know how to use the emergency stop at the platform and ground controls, and how the ground operator brings the platform down with the auxiliary or emergency lowering.\n\nThere must be a rescue plan, and someone trained on the ground controls nearby, before work begins.\n\nIf you are entrapped against a structure, use the emergency stop first. Report every accident, near-miss and malfunction right away.' },
    { title: 'Parking and shutting down', body: 'Stow the boom (lowered and retracted) and park on firm, level ground away from traffic and exits. Turn the machine off, set the brake and remove the key.\n\nRefuel only with the engine off and away from ignition sources, and charge batteries in a ventilated area, as the manual describes.' },
  ],
  questions: [
    { q: 'In a boom lift, fall protection means:', choices: ['Holding the top rail', 'A full-body harness with the lanyard on the platform’s anchor point', 'A lanyard tied to the nearest beam', 'None is needed if you’re careful'], answer: 1 },
    { q: 'Why is a boom lift called a Group B MEWP?', choices: ['It runs on batteries', 'Its platform can reach outside the machine’s tipping lines', 'It is only used outdoors', 'It carries two people'], answer: 1 },
    { q: 'The capacity decal shows two ratings. What does that mean?', choices: ['Choose whichever is higher', 'A higher capacity applies only in a restricted range; at full reach it is lower', 'One is for indoors and one for outdoors', 'It doesn’t matter'], answer: 1 },
    { q: 'Before moving the platform, you should:', choices: ['Look in the direction of travel, including overhead', 'Close your eyes and trust the alarm', 'Lean over the controls to see', 'Have someone stand under the platform'], answer: 0 },
    { q: 'When driving the machine across the site, the boom should be:', choices: ['Fully raised for visibility', 'Lowered and retracted unless the manual allows otherwise', 'Extended toward the destination', 'Any position'], answer: 1 },
    { q: 'A coworker asks you to lift a beam with the platform. You:', choices: ['Do it if it’s under the rated load', 'Refuse: the platform is never used as a crane', 'Tie the beam to the rails', 'Ask them to ride along'], answer: 1 },
    { q: 'You get pinned against a ceiling beam. First you:', choices: ['Keep moving to push free', 'Hit the emergency stop', 'Climb out of the platform', 'Call the office'], answer: 1 },
    { q: 'Who must be nearby while you work at height?', choices: ['No one', 'Someone trained to use the ground controls and emergency lowering', 'Only the site owner', 'A second lift operator in another lift'], answer: 1 },
    { q: 'How close may you get to an overhead power line?', choices: ['3 feet', 'No closer than 10 feet, more for higher voltages', 'Touching is fine with gloves', 'Any distance if it’s a phone line'], answer: 1 },
    { q: 'At the end of the shift you:', choices: ['Leave the boom up for the next crew', 'Stow the boom, turn it off, set the brake and remove the key', 'Park it in the driveway', 'Leave the key in it'], answer: 1 },
  ],
  checklist: [
    'Locates the manual and capacity decals; explains the rated load, reach limits and wind rating',
    'Completes the pre-start inspection and function tests from ground and platform controls',
    'Puts on a harness correctly and clips to the designated platform anchor',
    'Assesses the work area: ground, slopes, overhead hazards, power lines, people below',
    'Positions the boom smoothly, looking in the direction of travel, avoiding entrapment',
    'Drives with the boom stowed, slowly, on suitable ground',
    'Demonstrates the emergency stop and the ground auxiliary lowering procedure',
    'Stows, parks and shuts down correctly: boom down, off, brake set, key removed',
  ],
};

const CRANE: CourseInput = {
  title: 'Crane operator – employer evaluation (OSHA 1926.1427)',
  certType: 'Crane operator – employer evaluation',
  prerequisite: 'Crane operator certification (accredited)',
  description: 'This does not replace crane operator certification. Under OSHA 1926.1427, an operator needs a current certification from an accredited testing organization (such as NCCCO or NCCER) for the type and capacity of crane, and the employer must also evaluate them on the equipment before they operate it. This course reviews key site rules, and the hands-on part documents that evaluation. A worker can only be certified here once their accredited certification is on file. Review it with your lift director or safety lead.',
  recertMonths: 36,
  passScore: 80,
  lessons: [
    { title: 'Certification and evaluation', body: 'To operate a crane in construction, you need a certification from an accredited testing organization for the type and capacity of crane you will run. It is valid for up to five years.\n\nCertification alone isn’t enough. Before you operate, the employer must evaluate you on the equipment you will use, watching your skills, knowledge and judgment, and keep a record of it. You may need a new evaluation for different equipment or more demanding work.\n\nAn operator-in-training may operate only under the conditions OSHA sets, including continuous supervision by a qualified trainer.' },
    { title: 'Before the lift', body: 'A competent person inspects the crane every shift before use. Report anything wrong and don’t operate until it is fixed or cleared.\n\nThe ground must be firm, drained and graded enough, with mats or blocking where needed, to support the crane and its outriggers. Extend and set outriggers or stabilizers exactly as the manufacturer requires, and level the crane.\n\nKnow the weight of the load, the rigging and the hook block, the radius and boom length for the whole lift, and check them against the load chart before lifting.' },
    { title: 'Power lines', body: 'Power lines are a leading cause of crane deaths.\n\nBefore work, identify the work zone and find out whether any part of the crane, load or rigging could get within 20 feet of a power line (for lines up to 350 kV), or within 50 feet for lines over 350 kV.\n\nIf so, the line must be de-energized and grounded by the utility, or the crew must keep the required clearance using measures like a dedicated spotter, warning lines, range limiters and a planning meeting. Treat every line as energized until the utility confirms otherwise.\n\nIf contact happens, stay in the cab if you safely can, warn others to stay away, and don’t let anyone touch the crane or load.' },
    { title: 'Load charts and capacity', body: 'Never lift more than the load chart allows for the configuration, radius and boom length. Capacity drops quickly as the radius increases, so a load that is safe close in can tip the crane when swung out.\n\nInclude the weight of the hook block, rigging and any attachments in the load.\n\nAvoid side loading, sudden starts and stops, and shock loading. Anti-two-block devices must work; never bypass them. Respect the manufacturer’s wind limits.' },
    { title: 'Rigging and signals', body: 'Loads must be rigged by a qualified rigger where OSHA requires it, for example when workers are in the fall zone hooking or unhooking.\n\nWhen you can’t see the load or the landing area, or can’t see in the direction of travel, a qualified signal person must give you signals. Agree on the signal method (hand signals, voice or radio) before the lift.\n\nYou must obey a stop or emergency-stop signal from anyone, at any time.' },
    { title: 'During the lift', body: 'Do a test lift a few inches off the ground to check the brakes, the balance and the rigging.\n\nNo one may be under a suspended load except as OSHA allows for hooking, unhooking and specific connector work. Barricade the swing radius of the counterweight so no one can be struck or crushed.\n\nOperate smoothly. Never leave the controls while a load is suspended. Stop if conditions change: wind, visibility, ground or communication.' },
    { title: 'After the lift', body: 'Set the load down and unhook it. Stow the boom and secure the crane as the manufacturer requires, set the brakes and locks, and shut it down.\n\nReport any problem, accident or near-miss to the lift director or supervisor right away.' },
  ],
  questions: [
    { q: 'To operate a crane in construction you need:', choices: ['Only the employer’s permission', 'An accredited certification for that type and capacity, plus the employer’s evaluation', 'Only a driver’s license', 'Only this online course'], answer: 1 },
    { q: 'How long can an accredited crane operator certification last?', choices: ['One year', 'Up to five years', 'Forever', 'Until you change employers'], answer: 1 },
    { q: 'Part of the crane could get within 20 feet of a 13 kV power line. What happens?', choices: ['Nothing if you’re careful', 'The line is de-energized by the utility, or required clearance is kept with measures like a dedicated spotter', 'Lift faster to reduce the time near it', 'Only lift at night'], answer: 1 },
    { q: 'What happens to lifting capacity as the radius increases?', choices: ['It stays the same', 'It increases', 'It decreases', 'It depends on the operator'], answer: 2 },
    { q: 'Which weights count toward the load on the chart?', choices: ['Only the load itself', 'The load plus hook block, rigging and attachments', 'Only the rigging', 'Only what the client says'], answer: 1 },
    { q: 'You can’t see the landing area. You:', choices: ['Swing slowly and guess', 'Use a qualified signal person', 'Ask anyone nearby to shout', 'Use the horn'], answer: 1 },
    { q: 'A laborer who is not the signal person gives an emergency stop signal. You:', choices: ['Ignore it', 'Stop immediately', 'Finish the swing first', 'Ask the supervisor'], answer: 1 },
    { q: 'Why do a test lift a few inches off the ground?', choices: ['To check brakes, balance and rigging before the full lift', 'It isn’t needed', 'To warm up the engine', 'To impress the client'], answer: 0 },
    { q: 'Where may workers stand during the lift?', choices: ['Under the load to guide it', 'Outside the fall zone and the barricaded swing radius', 'Next to the counterweight', 'Anywhere with a hard hat'], answer: 1 },
    { q: 'The load is suspended and you need a break. You:', choices: ['Leave the cab briefly', 'Land the load first; never leave the controls with a load suspended', 'Ask the rigger to hold the controls', 'Lock the brake and go'], answer: 1 },
  ],
  checklist: [
    'Shows a current accredited certification for this crane type and capacity',
    'Reviews the shift inspection and recognizes defects',
    'Checks ground conditions; sets and levels outriggers or stabilizers per manufacturer',
    'Reads the load chart correctly for the planned lift, including rigging and hook block',
    'Identifies power lines and the required clearance or precautions',
    'Agrees on signals with the signal person; responds correctly, including to stop signals',
    'Performs a test lift; operates smoothly without shock or side loading',
    'Keeps loads out of the fall zone over people; swing radius barricaded',
    'Never leaves the controls with a load suspended',
    'Lands the load, stows the boom and secures the crane correctly',
  ],
};

export const TEMPLATES = {
  forklift: { label: 'Forklift (sit-down)', course: FORKLIFT_TEMPLATE },
  scissor: { label: 'Scissor lift', course: SCISSOR },
  boom: { label: 'Boom lift', course: BOOM },
  crane: { label: 'Crane operator evaluation', course: CRANE },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const isTemplate = (k: unknown): k is TemplateKey => typeof k === 'string' && k in TEMPLATES;
