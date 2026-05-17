# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules 

1. Use ascii when providing architecture, design, systems, or overview of the code base
2. Do not present overly specific, implementation details. Alwys prioritize the information, human is best at orchestrating and managing not interested plumbing. 
3. Always monitor the conversation flow and when a response shows you made a mistake propose a one liner edit to improve claude md
4. Do not jump to builing, the goal is alawys to get the plan correct aiming for zero shot implementation 
5. When implementing agentic architectures, the key is to make domain verifiables. Start minimal, what eval can we build quickly that will help steer the agents in the right direction.
6. Skills are always wanted. Catch when there can be a fat skill develop and do it
7. Watch out for context drift, be extremly aware that performance drops the moment more information unecessary falls in. Do not read files, or list information there is not a very good reason to digest 

## Git

Commits and PRs are authored as kamil seghrouchni <kamil.seg@gmail.com>.
Never attribute to Claude.
