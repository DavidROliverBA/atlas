-- One-off cleanup: remove load-test artefacts created during API stress
-- testing (relationships/placements cascade via FKs).
delete from elements
where name like 'Race%' or name like 'Race2%' or name like 'Parallel %'
   or name like 'Probe %' or name = 'Colour Probe' or name = 'Revision Probe';
